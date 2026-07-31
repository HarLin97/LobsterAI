# Startup credit campaign integration

## Change summary

The existing native client activity API now supports a second controlled
template, `native_startup_credit_v1`, alongside daily check-in. It represents a
startup modal that grants an authenticated user one time-limited credit reward.

The server continues to use the existing activity definition, immutable
revision, action ledger, and campaign-credit tables. No new database migration
is required. A successful `claim` is unique per activity and user through the
existing `periodKey = "once"` action-ledger constraint.

## Endpoint details

### Resolve the startup slot

`GET /api/client-activities/slot`

Query parameters:

- `placement=desktop_startup_modal`
- `clientVersion=<desktop app version>`
- `containerApiVersion=3`
- `platform=win32|darwin|linux`

Authentication is optional. When the slot is available, the activity
descriptor includes:

```json
{
  "slotState": "available",
  "serverTime": "2026-07-31T08:00:00Z",
  "activity": {
    "activityCode": "netease-user-reward-2026-test",
    "configRevision": 1,
    "activityType": "one_time_credit_reward",
    "placement": "desktop_startup_modal",
    "templateKey": "native_startup_credit_v1",
    "startAt": "2026-07-31T00:00:00Z",
    "endAt": "2026-08-31T00:00:00Z",
    "timezone": "Asia/Shanghai",
    "loginRequired": true,
    "periodLabel": "测试服活动",
    "cardTitle": "网易用户回馈",
    "modalTitle": "欢迎使用 LobsterAI",
    "modalDescription": "登录或保持登录即可领取 5000 限时积分",
    "actionText": "领取 5000 积分",
    "posterUrl": "https://nos.example/reward.png",
    "posterAlt": "LobsterAI 用户回馈活动"
  }
}
```

An unavailable or incompatible slot returns `slotState = "empty"`.

### Load user context

`GET /api/client-activities/{activityCode}/context?configRevision={revision}`

Authentication is optional. An active one-time reward context has this state:

```json
{
  "lifecycleState": "active",
  "authenticated": true,
  "state": {
    "claimed": false,
    "claimable": true,
    "rewardCredits": 5000,
    "rewardValidityDays": 30
  },
  "actions": ["claim"]
}
```

After a successful claim, `claimed` is true, `actions` is empty, and the state
also includes `claimedAt` and `expiresAt`.

### Claim the reward

`POST /api/client-activities/{activityCode}/actions/claim`

This endpoint requires the desktop JWT bearer token.

```json
{
  "configRevision": 1,
  "idempotencyKey": "startup-credit-<stable-attempt-id>",
  "payload": {}
}
```

A success response contains `creditsGranted`, `claimedAt`, `expiresAt`, and a
refreshed context. Reusing the same idempotency key replays the successful
result without granting credits again.

Relevant activity error codes:

- `51100`: activity not found
- `51101`: activity not active
- `51102`: login required
- `51104`: reward already claimed
- `51106`: configuration revision changed

## Frontend action items

- Resolve `desktop_startup_modal` independently from the existing
  `desktop_sidebar` slot.
- Treat `activityCode + configRevision + placement` as the bound activity
  identity before requesting context or executing an action.
- Persist a short-lived, non-secret login continuation containing the activity
  binding and idempotency key before opening browser login.
- After the browser callback restores authentication, resolve the slot and
  context again, then execute `claim` with the original idempotency key.
- Keep device-level auto-popup dismissal keyed by activity code. Dismissal must
  not hide the manual entry under “我的”.
- Map `51104` to the already-claimed result and `51100`/`51101` to an ended or
  unavailable result.

## Auth requirements

Slot and context requests may use no token or an optional desktop bearer token.
The claim endpoint requires a valid desktop bearer token. Admin configuration
and image upload endpoints require the existing `client-activities`
permission.

## Notes and caveats

- Eligibility is intentionally all authenticated LobsterAI users. There is no
  employee, acquisition-channel, registration-date, subscription, or
  enterprise-plan filter.
- Publish the server first, then configure the activity in Admin, and publish
  the compatible desktop client before activating the activity time window.
- The legacy World Cup credit-reset service is not used by this template.
