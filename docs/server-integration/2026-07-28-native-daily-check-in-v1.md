# 原生登录送积分活动接入说明（v1）

## 适用范围

本文描述 LobsterAI 原生“登录送积分”活动与 `lobsterai-server` 的接口约定。
该版本不加载远程 H5，也不提供页面 Bridge、活动 WebContentsView 或 URL 白名单能力。

客户端能力门槛：

- Placement：`desktop_sidebar`
- Container API：`2`
- 活动类型：`daily_check_in`
- 服务端 Handler：`daily_credits`
- 首发客户端版本由每期活动的 `minClientVersion` 控制

## Renderer 与 Main 的边界

Renderer 只能通过 preload 暴露的三条 IPC 使用活动能力：

- `activity:host:get-slot`
- `activity:host:get-context`
- `activity:host:execute-action`

Main 进程负责：

- 从当前环境的 Server 获取配置和状态；
- 使用客户端现有登录凭证发起可选鉴权或强制鉴权请求；
- 校验 Renderer 发送方、活动编码、修订号和幂等键；
- 将签到动作固定映射为 Server 的 `check_in`。

Renderer 不接触 access token，也不能指定任意活动 Action 或远程地址。

## Slot

```http
GET /api/client-activities/slot
  ?placement=desktop_sidebar
  &clientVersion=2026.7.30
  &containerApiVersion=2
  &platform=win32
```

可用活动示例：

```json
{
  "slotState": "available",
  "serverTime": "2026-07-28T12:00:00Z",
  "activity": {
    "activityCode": "login-seven-days-2026-phase-1",
    "configRevision": 1,
    "startAt": "2026-07-28T09:00:00Z",
    "endAt": "2026-08-11T09:00:00Z",
    "timezone": "Asia/Shanghai",
    "loginRequired": true,
    "periodLabel": "1期｜8/11结束",
    "cardTitle": "积分福利",
    "guestModalTitle": "登录后领取积分福利",
    "guestModalDescription": "积分可使用 DeepSeek、GLM、Kimi、Qwen 等模型",
    "guestModalActionText": "去登录"
  }
}
```

Server 只会下发 `native_daily_check_in_v1` 修订。数据库中遗留的远程 H5
修订不会进入该 Slot。

## Context

```http
GET /api/client-activities/{activityCode}/context?configRevision=1
```

```json
{
  "activityCode": "login-seven-days-2026-phase-1",
  "configRevision": 1,
  "lifecycleState": "active",
  "authenticated": true,
  "loginRequired": true,
  "serverTime": "2026-07-28T12:00:00Z",
  "state": {
    "totalDays": 7,
    "claimedDays": 2,
    "remainingDays": 5,
    "claimedToday": false,
    "completed": false,
    "rewardCredits": 100,
    "claimedCredits": 200,
    "timezone": "Asia/Shanghai"
  },
  "actions": ["check_in"]
}
```

`claimedCredits` 来自动作账本的实际累计金额，不使用
`claimedDays * 当前 rewardCredits` 推算，因此同一期修订调整奖励后仍准确。

## 签到

```http
POST /api/client-activities/{activityCode}/actions/check_in
Content-Type: application/json

{
  "configRevision": 1,
  "idempotencyKey": "daily-check-in-550e8400-e29b-41d4-a716-446655440000",
  "payload": {}
}
```

Main 进程使用现有的鉴权请求链路。Server 负责校验登录态、活动时间窗、
线上修订、当日唯一性、总领取次数和幂等性，并在事务内写入积分及动作账本。

关键业务错误码：

- `51100`：活动不存在
- `51101`：活动未开始、已结束或已失效
- `51102`：需要登录
- `51104`：今日已领取
- `51106`：配置修订已更新

客户端在 `51104` 时刷新 Context，在 `51106` 时重新获取 Slot；活动结束或不存在
时移除入口。

## 原生交互状态

Sidebar：

1. 未登录时显示活动卡片；
2. 点击领取只展示客户端原生登录引导；
3. 已登录且今日可领时直接调用签到；
4. 领取中禁止重复提交；
5. 成功后短暂显示“已领取 N 积分”；
6. 确认约 1.2 秒后隐藏 Sidebar 活动卡片；
7. 当日已领或本期完成后，页面重新加载时不再显示 Sidebar 卡片。

“我的”菜单：

- 登录用户在活动有效期内始终看到原生活动卡片；
- 展示真实期次、进度、累计领取积分和今日状态；
- 今日未领时可直接领取；
- 今日已领或完成后保留状态入口。

活动过期不使用端侧定时器。长运行窗口允许暂时保留旧 UI，下一次页面加载或刷新
时由 Slot/Context 消除；期间 Server 会拒绝所有过期 Action。

Sidebar 右上角关闭只写入当前 Renderer 会话的 `sessionStorage`，键包含活动编码和
修订号，不影响“我的”菜单。

## 本地联调

非打包开发版本可将活动 API 单独指向本地 Server：

```powershell
$env:LOBSTER_ACTIVITY_SERVER_BASE_URL='http://127.0.0.1:18878'
npm run electron:dev
```

覆盖值仅允许 loopback HTTP(S) origin。原生方案没有
`LOBSTER_ACTIVITY_WEB_APP_URL`。

## 验证命令

```powershell
npm test -- activityClient activityDevelopmentConfig dailyCheckInActivityState
npm run compile:electron
npm run build
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <touched-files>
```
