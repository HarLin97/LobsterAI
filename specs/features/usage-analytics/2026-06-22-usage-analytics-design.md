# LobsterAI 产品使用日志上报设计文档

## 1. 概述

### 1.1 问题/背景

LobsterAI 需要增加产品使用日志上报能力，帮助项目维护者了解应用安装和功能使用情况，为功能优化、兼容性改进和开发优先级提供数据依据。

计划关注的数据包括用户选择和使用的技能、MCP、专家套件、模型来源与模型类型，以及其他核心功能的使用情况。具体事件名称、触发时机和业务参数尚未确定，后续将在本文中逐步补充。

本阶段先建立独立、统一的日志请求入口，集中处理日志服务地址、通用参数、用户标识、时间戳和网络请求，避免各业务模块自行拼接和发送日志。

### 1.2 目标

1. 提供统一的有道 Analyzer 日志上报方法。
2. 集中维护日志请求地址和 `_npid`、`_ncat` 等通用参数。
3. 自动补充当前登录用户的 `yid`、事件发生时间戳和基础环境参数。
4. 允许业务模块传入 `action` 和事件特有参数。
5. 日志上报失败不能影响应用原有功能。
6. 在设置中提供用户可主动关闭的使用统计开关。
7. 为后续增加具体功能事件保留统一扩展入口。

### 1.3 非目标

当前阶段不包含以下内容：

- 除计划模式开启事件外，不在其他页面或功能中添加日志事件。
- 不确定技能、MCP、专家套件、模型和其他后续功能的事件命名与参数规范。
- 不实现请求队列、批量发送、失败重试、离线缓存或频率限制。
- 不实现安装 ID、匿名 ID 或跨会话用户行为分析。
- 不上传对话内容、文件内容、文件路径、密钥或其他用户业务数据。

## 2. 当前实现

### 2.1 文件位置

日志请求实现在：

```text
src/renderer/services/logReporter.ts
```

对应单元测试位于：

```text
src/renderer/services/logReporter.test.ts
```

计划模式开关是当前唯一调用 `reportYdAnalyzer()` 的业务入口。只有用户主动开启计划模式时才发送事件，关闭计划模式时不发送。

### 2.2 日志服务配置

当前请求地址和通用参数为：

```typescript
export const LogReporterEndpoint = {
  YoudaoAnalyzer: 'https://rlogs.youdao.com/rlog.php',
} as const;

export const LogReporterProduct = {
  LobsterAI: 'wisdom',
} as const;

export const LogReporterCategory = {
  Actions: 'actions',
} as const;

export const LogReporterActionPrefix = {
  LobsterAI: 'lobsterai_',
} as const;
```

所有 `action` 必须以 `lobsterai_` 开头。日志模块会拒绝发送不符合该命名规则的事件，避免不同业务模块产生无法统一检索的事件名称。

### 2.3 参数构建

`buildLogUrl()` 使用 `URL` 和 `URLSearchParams` 生成 GET 请求地址。最终参数由以下部分组成：

| 参数 | 来源 | 说明 |
|------|------|------|
| `_npid` | 通用配置 | 产品 ID，当前为 `wisdom` |
| `_ncat` | 通用配置 | 日志分类，当前为 `actions` |
| `action` | 业务调用方 | 事件名称，不能为空且必须以 `lobsterai_` 开头 |
| `app_version` | Electron 应用信息 | 当前应用版本；首次上报前异步读取并缓存，读取失败时为空字符串 |
| `os_platform` | Preload 暴露的运行环境 | 当前系统平台，例如 `darwin`、`win32`、`linux` |
| `os_arch` | Preload 暴露的运行环境 | 当前系统架构，例如 `arm64`、`x64` |
| `language` | 应用配置 | 当前应用语言 |
| `is_logged_in` | Redux 登录态 | 当前是否存在登录用户 `yid` |
| `log_Usid` | Redux 登录态 | 当前用户的 `yid`，未登录时为空字符串 |
| `uts` | 日志模块 | `Date.now()` 生成的毫秒时间戳 |
| 其他参数 | 业务调用方 | 当前事件特有的字符串、数字或布尔值参数 |

值为 `null` 或 `undefined` 的可选参数不会加入请求地址。

### 2.4 请求流程

```text
业务模块
  -> reportYdAnalyzer(params)
  -> 校验 action
  -> buildLogUrl(params)
  -> 自动补充通用参数、用户 ID、时间戳和基础环境参数
  -> window.electron.api.fetch(GET)
  -> 返回 true 或 false
```

请求复用现有的 Electron API 网络桥接，由主进程通过 Electron session 发出请求，以避免 Renderer 的 CORS 限制。

日志请求失败时只记录警告并返回 `false`，不会向调用方抛出异常，也不会阻断原业务流程。

Renderer 调试日志只记录事件 `action` 和请求结果，不记录完整请求地址或事件参数。主进程的通用 API 请求日志会移除 URL query 和 fragment 后再写入本地日志，避免 `log_Usid` 和事件参数进入本地日志文件。

### 2.5 设置开关

使用统计开关放在：

```text
设置 -> 通用 -> 帮助改进 LobsterAI
```

配置字段为 `usageAnalyticsEnabled`，存储在现有 `app_config` 中，默认值为 `true`。老用户本地配置中没有该字段时，按开启处理，不需要新增数据库表或迁移脚本。

用户关闭后，`reportYdAnalyzer()` 在发送请求前直接跳过并返回 `false`，不会访问日志服务。该跳过行为只写入一条 Renderer debug 日志，不影响业务流程。

用户可见文案应避免使用“日志上报”，避免误解为上传本地日志文件。当前中文文案为：

- 标题：`帮助改进 LobsterAI`
- 描述：`允许发送基础使用统计，帮助我们改进功能体验。不会上传对话内容、文件内容或 API Key。`

### 2.6 当前调用方式

计划模式开启事件当前按以下方式调用：

```typescript
void reportYdAnalyzer({
  action: LogReporterAction.PlanModeEnabled,
  entry: LogReporterEntry.PromptToolsMenu,
});
```

`action` 为 `lobsterai_plan_mode_enabled`，`entry` 为 `prompt_tools_menu`。调用使用 fire-and-forget 方式，不等待网络请求，不阻塞计划模式状态切换或界面交互。

## 3. 后续待完善内容

后续讨论和实现至少需要补充：

1. 确定默认开启和用户主动关闭的设置及持久化方式。
2. 定义所有事件名称、触发时机和允许上报的参数。
3. 定义安装、技能、MCP、专家套件、模型和其他功能的统计口径。
4. 确定自定义技能、自定义 MCP 和自定义模型信息的上报边界。
5. 继续评估是否需要补充安装来源、分发渠道等其他通用环境参数。
6. 评估是否需要安装 ID、去重、采样、批量发送和失败重试。
7. 补充隐私说明、数据保留周期和日志调试方式。
8. 明确测试、验收和发布检查标准。
