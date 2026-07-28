# Dynamic client activity / Activity Bridge V1

## 阶段 2 客户端交付

- Activity Contract V1 共享类型和 IPC 常量。
- 独立 `activityPreload`，远程 H5 只能访问：
  - `getRuntimeContext`
  - `getActivityContext`
  - `executeAction`
  - `requestLogin`
  - `close`
  - `onAuthChanged`
- `WebContentsView` 容器和主渲染进程控制 API：
  - `window.electron.activity.getSlot`
  - `window.electron.activity.open`
  - `window.electron.activity.setBounds`
  - `window.electron.activity.close`
  - `window.electron.activity.onClosed`
- Sidebar `Experience Slot`：
  - 页面加载时读取一次 Slot；
  - 动态活动命中时显示原生入口；
  - 未命中或请求失败时回退现有 `SidebarAdBanner`；
  - 点击后在应用内弹层嵌入 WebContentsView；
  - 支持加载、错误重试、关闭和窗口尺寸同步。
- 本次独立签到 H5 位于 `activities/login-seven-day/`。

## URL 下发

新活动使用 `webAppKey=remote_h5_v1`，Server Slot 下发：

- `webAppUrl`
- `navigationBaseUrl`
- `resourceBaseUrls`

客户端不限制 Share ID 或固定托管厂商，但只接受 Server 最新 Slot 中的 URL。用户点击时主进程会重新读取
Slot，并精确核对 `activityCode + configRevision`，Renderer 不能直接传入 URL。

历史 `generic_activity_v1` 固定测试/生产映射仍保留，避免阶段 1 已有修订失效；新活动不再依赖该固定页面。

非打包版本可用 `LOBSTER_ACTIVITY_WEB_APP_URL` 覆盖活动页面，且仅接受 loopback HTTP(S)，用于本地 H5 调试。

## 认证

远程 H5 不接收 access token、refresh token、Cookie 或 Launch Code。

Activity IPC 主进程复用现有 `AuthSessionManager.fetchWithAuth` 请求 Context 和 Action，因此与模型列表、
订阅信息等接口共用同一套 token 自动刷新和失效清理。

Slot 和 Context 允许游客：

- 本地已有 token 时优先走认证请求；
- token 被服务端判定失效时，可退回游客读取只读 Context；
- Action 始终要求认证；
- H5 申请登录时复用现有网页登录流程；
- 登录成功后只向活动页发送 `{ authenticated: true }`，H5 再主动刷新 Context。

Bridge 不暴露用户身份详情和 token。

## 容器安全边界

- `nodeIntegration=false`
- `contextIsolation=true`
- `sandbox=true`
- 独立、非持久化 partition
- 拒绝权限、下载和 `window.open`
- 主框架导航只允许 `navigationBaseUrl` 的同源路径前缀
- 子框架导航拒绝
- 网络资源只允许 `resourceBaseUrls` 路径前缀，以及受控的 data/blob 资源
- Activity Bridge 同时校验 WebContents、main frame URL、`activityCode + configRevision`
- 入口图片只接受无凭据、非 IP/本地保留 host 的 HTTPS URL

控制面信任仍然重要：拥有 `client-activities` 发布权限的人可以选择任意公开 HTTPS H5 和 CDN。
客户端隔离可以防止 H5 直接读取本地 Node/token，但不能保证第三方内容质量，也不替代 URL 冻结、
审计、CSP、内容审核和紧急下线。

## 生命周期

客户端不设置上下线定时器，也不轮询活动生命周期。

- Slot 在组件挂载和登录身份变化时读取；
- 长时间运行时，已过期入口暂时保留是允许的；
- H5 下次 Context 请求会收到 `ended`、`offline` 或 `superseded`；
- Action 由 Server 立即拒绝；
- 下一次页面加载或 Slot 刷新时移除入口。

这避免端侧时钟差异和长时间定时器，同时保证奖励发放不会越过服务端时间窗。

## 独立签到 H5

`activities/login-seven-day/` 是纯静态页面，不需要构建或第三方依赖：

- `index.html` / `styles.css`
- `app.mjs`
- `state.mjs`
- `state.test.mjs`
- `README.md`

正式模式只通过 `window.lobsterActivity` 工作；普通浏览器不获得登录态或 Action 能力。
`?preview=1` 提供 Admin/浏览器演示态。

页面支持游客登录引导、七天进度、当日签到、完成态、活动未开始/结束/下线/修订变化、
签到幂等键和错误重试。

## 兼容性

- 版本 `m` 以下：不会请求 Activity Slot，不能参与新活动；旧 Banner 不受影响。
- 版本 `m` 及以上：只要满足活动 `minClientVersion` 和 `requiredContainerApiVersion`，
  后续新增 H5 活动无需再发布客户端。
- 没有动态活动或请求失败：新客户端回退旧 Banner。
- 简单图片 + 链接仍通过旧 Admin 配置，并继续使用系统浏览器。

未来“邀请好友得积分二期”等活动，如果 Bridge V1 的 Context/Action 能表达页面交互，
只需新增独立 H5、Server Handler 和 Admin 配置；只有需要新原生能力时才升级 Container API。

## 验证

```powershell
# H5 纯状态测试
node --test activities/login-seven-day/state.test.mjs

# Activity 单元测试
npm test -- activitySecurity activityExperienceState activityClient

# Electron 主进程和生产 Renderer
npm run compile:electron
npm run build
```

2026-07-28 已完成：

- H5 状态测试 5/5；
- Activity Vitest 13 项通过；
- 修改文件 ESLint 通过；
- Electron compile 和生产 build 通过；
- 真实测试 Share URL 在 Chrome 中完成页面加载和签到交互；
- Server Activity API E2E 21/21 通过。
