# Dynamic client activity / Activity Bridge V1

## 本阶段客户端交付

- 新增 Activity Contract V1 的共享类型和 IPC 常量。
- 新增独立 `activityPreload`，远程 H5 只能访问：
  - `getRuntimeContext`
  - `getActivityContext`
  - `executeAction`
  - `requestLogin`
  - `close`
  - `onAuthChanged`
- 新增 `WebContentsView` 容器和主渲染进程控制 API：
  - `window.electron.activity.getSlot`
  - `window.electron.activity.open`
  - `window.electron.activity.setBounds`
  - `window.electron.activity.close`
- 新增开发验证页 `tools/activity-container-test/`。

本阶段没有把入口接入 Sidebar，也没有加入活动弹窗 React UI；这些属于后续客户端
体验层阶段。服务端表为空时，本版本没有用户可见变化。

## 认证

远程 H5 不接收 access token、refresh token、cookie 或 Launch Code。Activity IPC 主进程
通过现有 `AuthSessionManager.fetchWithAuth` 请求 Context 和 Action，因此模型列表、订阅
信息与活动请求共用同一套 token 自动刷新和失效清理。

Slot 和 Context 允许游客。主进程在本地存在 token 时先使用认证请求；若 token 被服务端
判定失效并清理，则以游客身份重新加载只读接口。Action 始终走认证请求。

现有网页登录流程通过 `requestLogin()` 复用，登录成功后只向活动页发送
`{ authenticated: true }` 事件；H5 收到后主动重新请求 Context。Bridge 不传用户身份
详情。

## 容器安全边界

- `nodeIntegration=false`
- `contextIsolation=true`
- `sandbox=true`
- 独立、非持久化 partition
- 所有权限请求拒绝，下载拒绝，`window.open` 拒绝
- 主框架只能在 `webAppKey` 对应的固定 origin + path prefix 内导航
- 子框架导航拒绝
- 网络资源也限制在相同 origin + path prefix；生产 H5 的脚本、样式和活动素材需同路径托管
- IPC 同时校验 WebContents、top frame URL、`activityCode + configRevision`
- 主渲染进程不能直接传 URL，只能传服务端 Slot 中的 code/revision；打开前会重新拉 Slot

生产和测试环境内置 `generic_activity_v1` 映射：

- 测试：`https://lobsterai.inner.youdao.com/activities/generic-v1/`
- 生产：`https://lobsterai.youdao.com/activities/generic-v1/`

非打包版本可用 `LOBSTER_ACTIVITY_WEB_APP_URL` 覆盖，但只接受 loopback HTTP(S) URL。

## 生命周期

客户端不设置上下线定时器，也不轮询活动生命周期。Slot 只在页面加载、组件重新挂载、
登录态变化或用户显式刷新时重新读取。主渲染页 reload/navigation 会关闭活动 View。

长时间运行导致过期入口暂时保留是允许的；H5 的下一次 Context 请求会得到 `ended`，
Action 由服务端拒绝，下一次 Slot 加载会移除入口。

## 本地验证

```powershell
npm run activity:test-h5
$env:LOBSTER_ACTIVITY_WEB_APP_URL='http://127.0.0.1:4178/'
npm run electron:dev
```

测试服务端需要预先配置一个满足当前客户端版本的测试活动。在主渲染 DevTools 中先调用
`window.electron.activity.getSlot()`，再以返回的 code/revision 和窗口内 bounds 调用
`window.electron.activity.open(...)`。

## 后续接入点

后续体验层只需在现有 Sidebar Banner 与 Dynamic Activity Slot 之间做入口仲裁，并在
点击动态活动时计算 View bounds。不要把远程 H5 URL 写入旧 `client_banners.link_url`，
旧客户端会把它交给系统浏览器。
