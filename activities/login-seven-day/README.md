# 登录送 7 天积分活动 H5

这是 `remote_h5_v1` 的首个独立活动页面。它是可直接上传到静态 Share 的纯静态站点：

- 入口为 `index.html`，无构建步骤、无第三方运行时依赖；
- 业务状态、登录与积分发放只通过 `window.lobsterActivity` Bridge；
- 页面无法读取 LobsterAI Token，也不会直接调用 Server API；
- 普通浏览器使用 `?preview=1` 可进入演示态，便于 Admin 沙箱预览；
- 生产发布应为每个内容版本创建新的不可变 Share URL，并在 Admin 中生成新活动修订。

本地预览：

```powershell
npx http-server . -p 4178 -c-1
```

浏览器打开 `http://127.0.0.1:4178/?preview=1`。纯状态单测：

```powershell
node --test state.test.mjs
```
