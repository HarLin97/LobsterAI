# AI 皮肤包 MVP 设计文档

## 1. 概述

### 1.1 背景

LobsterAI 已有颜色主题系统，但当前主题仅改变语义颜色 Token，不能根据用户描述生成视觉背景和首页标记。产品希望将 AI 生图能力包装为订阅权益的可感知场景，同时允许已经配置受支持图片 Provider 的用户使用自己的生成能力。

首个版本以展示型 Demo 为目标：从用户的一段风格描述出发，串行生成一张工作区背景和一个首页标记，注册为受管皮肤并立即应用。该版本不重排组件，不替换系统功能图标，不生成 Icon 精灵图，不追求完整的生产级任务恢复。

### 1.2 目标

- 提供内置“AI 皮肤设计师”Kit 和唯一入口 Skill。
- 使用结构化 `skin_pack` 工作流标记，不依靠自然语言识别特殊流程。
- 在 LobsterAI 订阅生图工具与 OpenClaw 原生生图工具之间确定性选择路线。
- 每个皮肤包默认以约两次生成完成两个必需槽位，并严格串行执行；异常恢复允许追加尝试。
- 将生成结果复制到 LobsterAI 受管目录，通过最小皮肤注册表应用。
- 空会话首页明显展示背景和标记；活跃会话只以宿主固定的低透明度复用背景。
- 用户可以在外观设置中预览、重新应用已生成皮肤，或恢复默认皮肤。

### 1.3 非目标

- 不生成或替换快捷动作、Sidebar、PromptInput、权限、状态、Artifact、文件类型、Agent 或用户图标。
- 不支持任意 CSS、HTML、SVG、字体、动画或布局定义。
- 不支持 Icon 精灵图。
- 不提供多皮肤列表、重命名、导入导出、云同步或逐槽重生成。
- 不在崩溃后自动重试付费请求，也不保证跨重启恢复未完成任务。

## 2. 用户场景

### 场景 1：订阅用户生成并应用皮肤

**Given** 用户已登录并具备 LobsterAI 图片生成权益，且选择“AI 皮肤设计师”Kit
**When** 用户输入“设计一套温暖的日落玻璃质感皮肤”
**Then** 系统选择 LobsterAI 图片工具，依次生成背景和标记，注册两个资产并应用皮肤。

### 场景 2：自定义 Provider 用户生成皮肤

**Given** 用户没有 LobsterAI 图片权益，但 OpenClaw `image_generate` 存在可用 Provider
**When** 用户通过 Kit 描述目标风格
**Then** Skill 使用 OpenClaw 原生图片工具完成同样的两个串行任务。

### 场景 3：没有可用生图能力

**Given** 用户没有 LobsterAI 图片权益，且没有可用 OpenClaw 图片 Provider
**When** 用户发起皮肤生成
**Then** 流程在付费生成前停止，并提示用户登录订阅或配置受支持 Provider。

### 场景 4：恢复默认皮肤

**Given** 当前存在已应用的 AI 皮肤
**When** 用户在“设置 - 外观”中点击恢复默认皮肤
**Then** 自定义图片立即停用，现有颜色主题继续生效。

### 场景 5：重新应用本地皮肤

**Given** 用户已生成并应用过一套完整皮肤，随后恢复了默认皮肤
**When** 用户在“设置 - 外观”的 AI 皮肤列表中点击该皮肤的“应用”
**Then** 系统直接重新应用受管目录中的既有资产，不再次调用生图工具。

### 场景 6：保留用户颜色主题

**Given** 用户已选择任意浅色或深色主题
**When** 用户应用、重新应用 AI 皮肤，或应用重启后恢复活跃皮肤
**Then** 系统只应用图片资产，不修改用户当前颜色主题。

## 3. 功能需求

### FR-1：结构化工作流

- 内置 Kit 使用稳定 ID 标记 `skin_pack` 工作流。
- 工作流标记由可信 Kit 元数据或稳定 Kit ID 解析，不从用户 Prompt 猜测。
- 运行时允许的生成任务固定为：
  1. `workspace.backdrop`
  2. `home.emblem`
- `generate` 使用约两次的软预算，不在主进程设置硬调用上限，也不把第 N 次调用硬绑定到某个槽位；`list`、`status` 和皮肤注册不属于生成尝试。
- 生成失败、无可用本地输出或候选无法满足必需槽位时，允许在同一路线内串行追加生成。

### FR-2：确定性工具路由

- 若当前用户具备 LobsterAI 图片权益，默认选择 `lobsterai_image_generate`。
- 否则仅在 OpenClaw 原生 `image_generate` 实际可用时使用该工具。
- 一旦开始第一个生成任务，整个皮肤包锁定同一后端和模型。
- 不在两个后端之间自动回退；异常时可在已锁定后端内串行恢复，无法恢复时停止并说明当前未完成槽位。

### FR-3：严格串行

- 只有背景生成达到终态成功并注册完成后，才能生成首页标记。
- LobsterAI 图片任务若异步返回，单次 `status` 工具调用应在插件内部自适应轮询到终态，不能让模型快速重复查询。
- OpenClaw 原生图片任务使用其现有后台完成与唤醒机制。

### FR-4：受控资产注册

- 生图工具必须返回精确本地路径或 `file://` URL。
- 注册工具仅接受 PNG、JPEG、WebP，拒绝网络 URL、data URL、SVG、HTML 和脚本格式。
- 文件经解码、大小和尺寸校验后复制到 `userData/skins`，使用内容哈希文件名。
- manifest 只保存受管目录内的相对路径，不长期引用会话工作目录。
- 两个必需槽位均有效时才允许应用。

### FR-5：Renderer 应用

- `workspace.backdrop` 只作用于 Cowork 主内容面板，不覆盖 Sidebar。
- 空会话首页明显显示背景，并使用固定遮罩保护文字和输入框。
- 活跃会话复用同一背景，主题主体应可辨认；透明度和遮罩强度由代码固定，不能由模型或 manifest 控制。
- 背景层挂载在稳定的 Cowork 容器中；切换 Agent、会话或首页/会话状态时复用同一个已加载图片节点，仅切换宿主遮罩强度。
- `home.emblem` 只替换 Cowork 首页 48px 标记，不覆盖 Windows 标题栏、启动界面、设置页、导出水印或应用图标。
- active skin URL 应包含内容哈希或版本，避免 Chromium 缓存旧图。
- AI 皮肤与颜色主题互相独立；应用、重新应用和启动恢复皮肤均不得自动切换颜色主题。旧 manifest 的 `baseThemeId` 只作为兼容元数据保留，不驱动 Renderer 行为。

### FR-6：最小管理能力

- 提供 `create_draft`、`register_asset`、`status`、`apply`、`deactivate`。
- MVP 仍仅维护一个 active skin，但外观设置列出本机所有 `ready` 皮肤，并使用真实背景和首页标记提供预览。
- 每个非当前皮肤提供“应用”入口；恢复默认不会删除受管资产，之后仍可重新应用。
- 外观设置提供“恢复默认皮肤”入口；MVP 不提供删除、重命名、导入或导出。
- 应用和停用后通过 IPC 事件通知 Renderer 刷新。

## 4. 实现方案

### 4.1 Kit 与 Skill

新增内置 Kit `ai-skin-designer`，绑定 bundled Skill `skin-creator`。Kit 负责入口、示例问题和 `skin_pack` 标记，并使用与现有 Kit 一致的 CDN PNG 图标；`SKILL.md` 负责 style bible、两槽位 Prompt、调用顺序、停止条件和工具参数。

### 4.2 运行时标记与媒体策略

共享常量定义 `SkinWorkflowKind.SkinPack` 与两个 `SkinAssetSlot`。Cowork 会话由 Kit ID 解析工作流，运行时适配器据此生成专用媒体系统指令：普通图片请求继续保持单次生成限制，皮肤包默认使用约两次串行生成，并以两个必需槽位的注册状态作为完成依据。

订阅路径在会话开始时获得图片模式媒体选择；没有订阅权益时不激活 LobsterAI 媒体选择，由 Skill 使用实际存在的 OpenClaw 原生工具。

### 4.3 图片异步完成

扩展 `lobsterai_image_generate action=status`：在一次工具执行内按递增间隔轮询，直到 `succeeded`、`failed`、`cancelled` 或超时，并通过 tool update 发送阶段性状态。这样模型不会并发发起下一槽位，也不需要自行 sleep 或忙轮询。

### 4.4 皮肤注册表

主进程新增独立 `skins` 模块，不继续向大型 `main.ts` 堆积业务逻辑。模块负责草稿、资产校验与复制、active 指针、协议路径解析和原子写入。资产目录示例：

```text
userData/skins/
├── registry.json
└── <skinId>/
    ├── manifest.json
    └── assets/
        ├── workspace.backdrop-<hash>.webp
        └── home.emblem-<hash>.png
```

OpenClaw 内置桌面工具 `lobsterai_skin_manage` 复用已认证的本地 callback bridge，并由主进程验证当前会话确实是 `skin_pack` 后再执行操作。

主进程内的职责进一步按以下边界拆分：

- `skinRuntimeController.ts`：供 `main.ts` 使用的单一门面，组合 Store、工作流注册表和媒体桥。
- `skinWorkflowRegistry.ts`：可信 Kit 校验、会话/父会话事务状态、路由选择和生命周期清理。
- `skinMediaBridge.ts`：`lobsterai_skin_manage` 调用校验、会员生图前置校验和槽位完成状态检查；不实现硬生成次数账本。
- `registerSkinElectron.ts`：特权协议、IPC 与 Renderer 变更广播。
- `skinPackKitLifecycle.ts`：内置 Kit 的目录合并、安装、卸载和 bundled Skill 启停。
- `skinStore.ts`、`skinImageValidation.ts`、`skinProtocol.ts`：持久化、安全校验与受限资产读取。

`main.ts` 只作为组合根：创建控制器、准备会话 Turn、转发工具调用，并把 runtime error/session delete 生命周期事件委托给控制器。OpenClaw 原生 `image_generate` 会在后台任务完成前后触发多次 runtime wake；因此普通 `complete` 事件不能清理 `skin_pack` 事务。事务只在成功 `apply`/`deactivate`、显式开启不带该 Kit 的新 Turn、runtime error 或会话删除时清理。

### 4.5 安全资产协议与 Renderer

新增受限 `lobster-skin://asset/<skinId>/<slot>?v=<hash>` 协议。协议仅解析注册表中存在且位于 `userData/skins` 内的资产，不接受任意本地路径。

Renderer 通过 preload 的 `skin.getActive()`、`skin.list()` 和 `skin.onChanged()` 获取归一化 manifest。Cowork 首页与活跃会话共享一个稳定挂载的 backdrop layer；外观设置通过 `skin.apply()` 重新应用既有皮肤，并通过 `skin.deactivate()` 恢复默认图片皮肤。两种操作都不修改颜色主题。

## 5. 边界情况

| 场景 | 处理方式 |
|------|---------|
| 用户输入要求生成更多图片或 Icon | 忽略超出 MVP 槽位的扩展要求，生成尝试仍围绕两个必需槽位 |
| 生成任务失败、超时或结果不可用 | 保持串行，可在同一路线内恢复；无法恢复时停止并保留 draft |
| 第二个任务失败 | 保留 draft 供诊断，但不应用 |
| 生成成功但没有本地路径 | 停止注册，不扫描会话目录猜测文件 |
| 注册文件格式或尺寸不合法 | 拒绝并报告当前槽位 |
| 应用时缺少任一槽位 | 拒绝应用，旧皮肤保持不变 |
| 应用运行中退出 | MVP 不自动恢复生成；已完成 active skin 可在下次启动加载 |
| 原生生图等待期间 runtime 发出 `complete` | 保留内存事务，等待后台完成后的同会话 wake 继续注册 |
| runtime error 或会话被删除 | 清理对应会话事务；不自动重试或应用半成品 |
| 图片缓存未刷新 | 使用内容哈希 URL |
| 切换 Agent 或会话时背景闪现 | 在 Cowork 稳定容器复用同一个图片节点，不随会话详情销毁重建 |
| 背景与文字对比不足 | 宿主固定遮罩与会话低透明度，不接受 manifest opacity |
| 用户停用皮肤 | 移除 active 指针，保留当前颜色主题 |

## 6. 涉及文件

- `SKILLs/skin-creator/`：官方生成工作流与资产规范。
- `src/shared/skin/`：工作流、槽位、IPC、协议常量与类型。
- `src/main/skins/`：运行时门面、会话工作流、媒体桥、Kit 生命周期、皮肤存储、校验、协议与 IPC。
- `openclaw-extensions/lobster-media-generation/`：图片状态轮询与皮肤管理工具桥。
- `src/main/libs/agentEngine/`：`skin_pack` 运行时标记及媒体指令。
- `src/main/main.ts`、`src/main/preload.ts`：最小组合根和 IPC 暴露；不承载皮肤业务状态机。
- `src/renderer/services/skin.ts`：Renderer 皮肤状态服务。
- `src/renderer/components/cowork/`：背景和首页标记渲染。
- `src/renderer/components/skin/`：皮肤预览、重新应用和恢复默认入口。
- `src/renderer/services/i18n.ts`：中英文文案。

## 7. 验收标准

1. 从“AI 皮肤设计师”Kit 输入任意明确风格描述后，系统默认以约两次生成完成两个必需图片槽位；异常恢复允许增加尝试。
2. 所有生成尝试严格串行；背景未成功注册时不会推进首页标记。
3. 有 LobsterAI 图片权益时使用会员工具；否则在原生图片工具可用时使用自定义 Provider。
4. 两个最终资产使用同一后端和模型，不发生并发生图或跨后端回退。
5. 生成文件被复制到受管皮肤目录，manifest 不引用会话工作目录。
6. 应用后首页明显显示新背景和新标记；活跃会话能辨认背景主题且文字仍保持可读；切换 Agent 或会话时不重新挂载同一背景图片。
7. 系统 Sidebar、状态、权限、Artifact、用户和 Agent 图标均未改变。
8. 外观设置以真实图片预览所有完整皮肤，可以恢复默认，也可以在恢复默认后重新应用既有皮肤；重新应用不触发生图，应用、停用和重启恢复均保留用户当前颜色主题。
9. 非 `skin_pack` 会话不能调用皮肤注册工具。
10. 新增/修改 TypeScript 文件通过 touched-file ESLint，相关 Vitest、Electron 编译和 Renderer 构建通过。
