# 模型思考强度控制联调说明

## 范围与结论

本期由 `lobsterai-server`、`lobsterai-admin` 和 LobsterAI Electron 客户端协同完成。服务端继续保留 `supportsThinking` 和 `runtimeProfile`，并为支持用户选择思考强度的模型新增可选字段：

```json
{
  "thinkingConfig": {
    "levels": ["off", "high", "max"],
    "defaultLevel": "high"
  }
}
```

- `supportsThinking` 表示模型具有思考能力，可兼容只认识布尔值的旧客户端。
- `thinkingConfig` 表示客户端可向用户开放的强度集合；字段缺失或非法时必须按“不支持选择”处理。
- `runtimeProfile` 仍用于 Kimi K3 等非强度型运行时适配，不能用它承载 UI 强度列表。
- 本期合法强度为 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`；具体模型只下发其允许的子集。

## 接口约定

模型列表、公开价格目录和管理端模型对象均增加 `thinkingConfig`。示例：

```json
{
  "modelName": "deepseek-v4-flash",
  "supportsThinking": true,
  "runtimeProfile": null,
  "thinkingConfig": {
    "levels": ["off", "high", "max"],
    "defaultLevel": "high"
  }
}
```

新客户端在模型列表请求和模型代理请求中发送：

```http
X-LobsterAI-Client-Capabilities: kimi-k3-agentic-v1,thinking-level-control-v1
```

服务端只有在客户端声明 `thinking-level-control-v1`、模型存在合法配置且请求值属于允许列表时，才接受用户选择。`off` 会关闭 thinking 并移除 effort；其他值会开启 thinking 并写入对应 effort。

## 管理端写入语义

- `thinkingConfig` 未出现在更新请求中：保留数据库原值，兼容旧管理端。
- 显式传 `null`：清除用户可选强度配置。
- `supportsThinking=false`：服务端同步清除 `thinkingConfig`，避免矛盾状态。
- 配置非空时，`levels` 必须非空、去重且全部合法，`defaultLevel` 必须包含于 `levels`。
- 管理端先开启“支持思考”，再选择是否开放强度调整；保存前执行同样校验。

## 客户端与运行时

LobsterAI 按服务端列表动态渲染思考强度入口，不硬编码 DeepSeek 型号。模型悬浮详情展示当前或默认强度，并打开相邻的二级选择页。受套餐限制的模型继续走原登录/订阅拦截。

会话本地新增 `thinking_level`。切换模型时，模型 ID 与思考强度作为同一次会话更新提交；新会话使用模型 `defaultLevel`，旧会话或空值在运行时解析为当前模型默认值。OpenClaw 配置同步将 `thinkingConfig` 转换为 `thinkingProfiles`，模型兼容插件在每轮请求前恢复对应 thinking 设置，防止运行时会话状态漂移。

## 版本兼容矩阵

| 客户端 | 服务端数据 | 行为 |
| --- | --- | --- |
| 旧客户端 | 新服务端新增字段 | JSON 未知字段被忽略，既有模型选择与 `supportsThinking` 行为不变 |
| 新客户端 | 旧服务端无字段 | 不显示强度入口，按既有固定思考行为运行 |
| 新客户端 | 新服务端合法配置 | 动态显示并仅允许选择下发列表中的值 |
| 新客户端 | 新服务端非法/未知值 | 客户端忽略配置，不显示入口；代理端也不接受该值 |
| 旧管理端 | 新服务端 | 更新请求不带字段时保留原配置 |

DeepSeek 兼容策略：

- `deepseek-v4-pro` 在原生 `api.deepseek.com` 路由上，对未声明新能力的旧客户端保持强制 `max`。
- 历史别名 `deepseek-v4-pro-thinking` 在原生 DeepSeek 路由上继续映射到 Pro 并强制 `max`，不作为新的可配置模型暴露；同名第三方路由保持旧请求不变。
- `deepseek-v4-flash` 对旧客户端维持既有请求体；只有新客户端声明能力后才使用可选强度。

## 数据库与发布顺序

先执行 `lobsterai-server/sql/V65__model_thinking_config.sql`。该脚本新增 `model_pricing.thinking_config JSON NULL`，并为 LobsterAI 渠道中的 `deepseek-v4-flash`、`deepseek-v4-pro` 初始化：

```json
{"levels":["off","high","max"],"defaultLevel":"high"}
```

推荐发布顺序：

1. 执行 V65 并核验 JSON 列和两条 DeepSeek 配置。
2. 发布 server；此时旧客户端和旧 admin 可继续工作。
3. 发布 admin，用于后续模型级配置维护。
4. 发布 LobsterAI 客户端，逐步启用 `thinking-level-control-v1`。

数据库核验：

```sql
SHOW COLUMNS FROM model_pricing LIKE 'thinking_config';

SELECT provider, model_id, supports_thinking, thinking_config
FROM model_pricing
WHERE provider = 'LobsterAI'
  AND model_id IN ('deepseek-v4-flash', 'deepseek-v4-pro');
```

## 回滚与卡点

- 客户端回滚无需回滚数据库；旧客户端会忽略新增字段。
- server 回滚前不必删除列，但旧 server 不会读取或维护该配置。
- 如需关闭入口，优先由 admin 显式清空单模型 `thinkingConfig`，不必回滚客户端。
- 模型元数据变化会使 OpenClaw 配置指纹变化并触发网关重启；批量修改模型时应合并发布，避免连续重启。
- 不同上游 provider 对 effort 枚举的支持可能不同。新模型上线前必须在 server allowlist、下发配置和实际 provider 三处联合验证，不能仅依赖 UI 可选项。
- `thinkingConfig` 是产品能力配置，不代表套餐授权；套餐可用性仍由模型列表中的原有访问控制字段决定。
- 当前 Electron 会话表迁移为空字符串默认值，因此升级后已有会话会采用服务端当前默认强度，而不会固定历史默认值。

## 本地开发环境覆盖

- `LOBSTER_SERVER_BASE_URL` 是唯一的 server origin 覆盖变量；活动、模型列表、鉴权刷新、OpenClaw 代理、媒体及其他 server API 都会统一切换到该地址，避免同一客户端同时连接两个鉴权域。
- 覆盖仅在未打包开发态生效，并且只接受带显式端口的字面量 loopback HTTP(S) origin，例如 `http://127.0.0.1:18878` 或 `https://[::1]:18878`。不接受 `localhost`、账号、路径、查询参数或 fragment。
- 启用覆盖后，主进程会输出一次醒目的开发 origin 警告。打包版本忽略该环境变量，防止发布包被环境注入后改写服务地址。
- 覆盖不会自动隔离本地持久化的登录令牌、模型缓存和会话数据。Bearer token 会发送给指定的本机服务，因此只能连接受信任的本地进程；生产令牌也可能被测试 server 拒绝并触发退出登录。切换环境前应确认目标 origin，必要时重新登录对应环境。

## 验收清单

- server：配置校验、管理端字段省略/清空、旧客户端 Pro 强制 max、新客户端 off/high/max 和非法值回退均有测试。
- admin：类型检查和生产构建通过；编辑、关闭与默认值校验可正常提交。
- LobsterAI：共享解析器、模型缓存、能力头、SQLite、OpenClaw 配置同步及运行时请求 patch 测试通过；生产构建和 touched-file ESLint 通过。
- 本地联调：server 使用 `test` profile 连接测试 MySQL，admin API 指向本地 server；两项服务启动后分别检查 HTTP 页面/API 和数据库回读。
