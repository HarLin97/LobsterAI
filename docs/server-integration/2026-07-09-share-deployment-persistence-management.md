# 服务部署数据保护管理 Spec

## 背景

当前 Node 服务分享部署已经支持通过火山云 NAS + veFaaS 实现轻量级文件系统持久化。客户端会自动识别常见本地数据路径，例如 `data/`、`uploads/`、`storage/`、`*.sqlite`，并在部署 manifest 中自动写入 `persistence.bindings`。

现状的问题是：用户无法参与决策，也无法在部署后管理线上数据。对于问卷统计、排行榜、本地数据文件这类轻量级服务，自动识别可以降低门槛，但以下场景必须给用户明确控制：

- 用户想选择哪些本地目录或文件需要在更新服务后继续保留。
- 用户想关闭自动识别出的路径。
- 用户想下载线上数据备份，用于排查或本地迁移。
- 功能迭代导致数据保存方式变化，需要先拉取线上数据，在本地完成迁移后再部署。
- 用户想清空、替换或重置线上数据。

本 spec 设计客户端和服务端协作方案。目标是保持“用户不需要理解数据库、NAS、VPC”的产品体验，同时给有数据风险的操作提供足够明确的控制和确认。工程实现仍使用 `persistence` 命名，用户默认只看到“服务数据”“线上数据”“数据空间”等产品语言。

## 目标

1. 服务部署前，用户可以确认、添加、删除需要保存的本地内容。
2. 自动识别从“直接生效”改为“自动保护 + 可查看/可修改”，最终以用户确认结果为准。
3. 更新服务默认保留线上数据，不覆盖用户线上数据。
4. 支持下载线上数据备份到本地。
5. 支持线上数据管理，包括查看保存内容、下载备份、清空、用本机数据替换线上数据。
6. 对本地数据文件和数据结构变化提供明确工作流。
7. V1 默认不暴露 NAS、VPC、挂载点、SQLite、schema 等技术概念；仅在高级详情中显示。

## 非目标

- V1 不做在线 SQL migration runner。
- V1 不做线上文件浏览器的逐文件编辑。
- V1 不支持多个云存储 provider，仍只支持 `filesystem`。
- V1 不支持跨分享复用同一份数据。
- V1 不做精确实时用量统计，允许服务端返回估算值或最近一次扫描值。

## 用户体验

### 产品原则

目标用户是非技术用户。默认交互必须回答三个问题：

1. 这个服务会不会保存用户数据。
2. 更新服务后，这些数据会不会丢。
3. 我能不能下载、备份、恢复或清空这些数据。

默认 UI 不直接出现以下词语：

- 持久化。
- NAS、VPC、挂载点、Provider、binding、mount path。
- SQLite、schema、migration。
- 云端路径、远端目录。

这些概念可以出现在“高级详情”“问题诊断”“开发者日志”中。

用户侧术语映射：

| 工程概念 | 用户侧文案 |
|---|---|
| persistence | 服务数据保护 |
| persistent data | 服务数据 |
| remote/cloud data | 线上数据 |
| download remote archive | 下载线上数据备份 |
| overwrite remote | 用本机数据替换线上数据 |
| quota | 数据空间 |
| SQLite/schema migration | 数据保存方式发生变化 |

交互分三层：

| 层级 | 面向用户 | 展示内容 |
|---|---|---|
| 默认层 | 所有用户 | 服务数据是否已自动保护、更新服务是否保留数据 |
| 查看层 | 关心数据的用户 | 当前保存哪些本地内容、可添加/移除 |
| 高级层 | 开发者或客服排障 | 技术路径、云端目录、策略、诊断信息 |

### 部署确认弹窗

在现有“确认服务部署”弹窗中增加 `服务数据` 区块。该区块只在 Node 服务部署中显示，静态站点不显示。

默认状态：

- 如果自动识别到候选路径，默认开启服务数据保护。
- 如果没有候选路径，默认关闭，并提示用户可手动添加。
- 用户可以点击“查看保存内容”确认、添加或移除路径。

识别到候选路径时，默认收起展示：

```text
服务数据    已自动保护

这个服务可能会保存用户数据，例如排行榜、问卷结果或上传内容。
更新服务后，这些数据会继续保留。

[查看保存内容]

更新服务时：保留线上已有数据（推荐）
数据空间：100 MB
```

没有识别到候选路径时：

```text
服务数据    未开启

未检测到这个服务会保存用户数据。部署后如果需要保存排行榜、问卷结果或上传内容，可以手动添加要保存的文件夹。

[添加要保存的文件夹]
```

展开“查看保存内容”后：

```text
将保存这些内容

✓ data/              可能包含排行榜、问卷结果或服务数据
✓ leaderboard.sqlite 本地数据文件

[添加其他文件夹] [高级]
```

每个路径项支持：

- 勾选/取消。
- 显示本地路径。
- 显示类型：文件或目录。
- 显示本地大小。
- 显示识别原因，例如“可能包含排行榜、问卷结果或服务数据”“本地数据文件”。
- 在高级模式中修改线上保存名称，默认等于本地相对路径。
- 删除。

路径选择约束：

- 只能选择当前项目目录内的文件或目录。
- 不能选择项目根目录本身。
- 不能选择绝对路径、包含 `..` 的路径、符号链接。
- 不能选择 `.git`、`node_modules`、`.env`、构建产物目录。
- V1 最多允许 8 个绑定，默认建议只选择一个主数据目录。

### 推荐路径文案

自动识别结果使用“自动保护 + 可查看”语义，不要求用户理解路径含义：

```text
已自动保护这个服务可能产生的数据。你可以查看或调整保存内容。
```

常见推荐规则：

| 路径 | 类型 | 推荐原因 |
|---|---|---|
| `data/` | 目录 | 可能包含排行榜、问卷结果或服务数据 |
| `uploads/` | 目录 | 可能包含用户上传的文件 |
| `storage/` | 目录 | 可能包含服务保存的数据 |
| `*.db` | 文件 | 本地数据文件 |
| `*.sqlite` | 文件 | 本地数据文件 |
| `*.sqlite3` | 文件 | 本地数据文件 |

### 更新服务时的数据策略

默认层只展示一行：

```text
更新服务时：保留线上已有数据（推荐）
```

高级层开放两个选项：

| 策略 | 含义 | 默认 |
|---|---|---|
| `keep_remote` | 保留线上已有数据 | 是 |
| `overwrite_remote` | 用本机数据替换线上数据 | 否 |

`keep_remote` 行为：

- 如果线上目标不存在，用本地数据初始化。
- 如果线上目标存在，使用线上数据。
- 新部署代码包中的本地数据不会覆盖线上数据。

`overwrite_remote` 行为：

- 部署前或部署过程中用本机数据替换线上目标。
- 需要二次确认。
- 确认文案必须包含分享名、路径和风险。

高危确认文案：

```text
这会用本机 data/ 替换当前线上数据。线上新增的排行榜、问卷结果或用户上传内容可能丢失。
请输入“替换线上数据”继续。
```

后续版本可扩展：

- `merge_missing`：只补充云端缺失文件。
- `clear_then_seed`：清空云端后用本地初始化。

### 本地数据文件迁移提示

如果选择项中包含 `.db`、`.sqlite`、`.sqlite3`，部署弹窗显示用户可理解的提示，不直接出现 SQLite/schema：

```text
检测到服务使用本地数据文件。
如果这次你让龙虾修改了数据保存方式，建议先下载线上数据备份，再部署。
```

提供操作：

- `下载线上数据备份`
- `查看迁移建议`

迁移建议：

1. 下载线上数据备份到本地快照目录。
2. 在本地用新代码启动服务或运行迁移脚本。
3. 验证数据和功能正常。
4. 部署时选择：
   - 代码能自动迁移：使用 `保留线上已有数据`。
   - 已在本地完成迁移：选择 `用本机数据替换线上数据`。

## 部署后管理

在服务分享详情或服务部署详情中增加 `服务数据` 面板。

默认展示字段：

- 启用状态。
- 数据空间，例如 `100 MB`。
- 已使用空间，允许显示“估算”。
- 保存内容列表：
  - 本地路径。
  - 类型。
  - 识别原因。
- 最近一次备份下载时间。
- 最近一次替换/清空操作时间。

高级详情展示字段：

- Provider：显示为“文件系统”，不显示 NAS。
- 本地挂载路径，例如 `/data`。
- 线上保存根目录。
- 绑定列表的线上路径。
- 最近部署策略。

操作：

| 操作 | V1 支持 | 说明 |
|---|---|---|
| 下载线上数据备份 | 是 | 下载整个服务数据目录 zip |
| 拉取到项目目录 | 是 | 下载后可选择覆盖本地路径，默认不覆盖 |
| 清空线上数据 | 是 | 高危，二次确认 |
| 用本机数据替换线上数据 | 是 | 高危，二次确认 |
| 查看线上文件列表 | 可选 | V1 可只展示绑定级别，不做文件树 |
| 删除分享时删除数据 | 可选 | 默认停止服务不删数据 |

默认策略：

- 停止部署或替换部署时，不删除线上数据。
- 删除分享时，默认保留线上数据，并提示用户可手动删除。
- 只有用户明确执行“清空线上数据”或“删除服务数据”时才删除。

## 下载线上数据备份

### 用户流程

入口：

- 部署确认弹窗：`下载线上数据备份`
- 服务详情服务数据面板：`下载线上数据备份`

下载行为：

1. 客户端调用服务端创建下载任务或直接下载 zip。
2. 服务端从该分享的服务数据根目录打包 zip。
3. 客户端保存到默认目录：

```text
<project>/.lobster/persistence/<shareId>/<yyyyMMdd-HHmmss>/
```

4. 下载完成后显示：

```text
线上数据备份已下载到 .lobster/persistence/shr_xxx/20260709-153000/
```

默认不覆盖项目中的 `data/` 或本地数据文件。用户需要点击 `应用到项目` 才会覆盖或合并。

### 应用到项目

下载完成后提供：

- `在 Finder 中显示`
- `应用到项目`
- `仅作为备份保留`

`应用到项目` 时：

- 默认创建本地备份：

```text
<project>/.lobster/backups/persistence-before-apply/<yyyyMMdd-HHmmss>/
```

- 对每个保存项展示覆盖计划。
- 文件覆盖和目录覆盖都需要二次确认。

## 客户端数据结构

### 分析结果

将现有 `analysis.persistence` 拆成“候选项”和“最终选择”两个概念。

```ts
interface ShareDeploymentPersistenceCandidate {
  appPath: string;
  kind: 'file' | 'directory';
  sizeBytes: number;
  reason: 'common_data_dir' | 'upload_dir' | 'sqlite_database' | 'manual';
  recommended: boolean;
}

interface ShareDeploymentPersistenceSelection {
  enabled: boolean;
  quotaBytes: number;
  redeployPolicy: 'keep_remote' | 'overwrite_remote';
  bindings: ShareDeploymentPersistenceBinding[];
}
```

V1 可以兼容现有字段：

```ts
interface ShareDeploymentProjectAnalysis {
  persistence?: ShareDeploymentPersistence;
  persistenceCandidates?: ShareDeploymentPersistenceCandidate[];
}
```

兼容规则：

- 老服务端或老客户端只认识 `persistence`。
- 新客户端内部使用 `persistenceCandidates` 渲染 UI。
- 用户确认后仍生成现有 `manifest.persistence`，避免一次性改动服务端主链路。

### Manifest

保持现有 manifest 结构，增加可选策略字段：

```json
{
  "persistence": {
    "enabled": true,
    "provider": "filesystem",
    "quotaBytes": 104857600,
    "redeployPolicy": "keep_remote",
    "bindings": [
      {
        "appPath": "data",
        "dataPath": "data",
        "kind": "directory",
        "sizeBytes": 506
      }
    ]
  }
}
```

如果服务端暂不支持 `redeployPolicy`，客户端仍可发送，服务端忽略未知字段；默认行为必须等价于 `keep_remote`。

### 本地偏好缓存

同一项目下，用户的服务数据选择应被记住，避免每次部署重复选择。

缓存 key：

```text
share-deployment:persistence-selection:<clientSourceKey>
```

缓存内容：

```json
{
  "enabled": true,
  "redeployPolicy": "keep_remote",
  "bindings": [
    { "appPath": "data", "dataPath": "data", "kind": "directory" }
  ],
  "updatedAt": "2026-07-09T15:30:00+08:00"
}
```

合并规则：

1. 新分析得到候选项。
2. 如果存在缓存，优先恢复用户上次选择。
3. 如果缓存路径已不存在，显示为“路径不存在”，默认取消勾选。
4. 新增候选项显示为“新检测到”，默认勾选。

## 服务端 API 设计

### 查询服务数据信息

```http
GET /api/share-deployments/{deploymentId}/persistence
```

返回：

```json
{
  "enabled": true,
  "provider": "filesystem",
  "mountPath": "/data",
  "quotaBytes": 104857600,
  "usedBytes": 20480,
  "usedBytesEstimated": true,
  "status": "ready",
  "bindings": [
    {
      "appPath": "data",
      "dataPath": "data",
      "kind": "directory",
      "sizeBytes": 506
    }
  ],
  "lastDownloadedAt": null,
  "updatedAt": "2026-07-09T15:30:00"
}
```

也可以先把这些字段复用到现有部署详情 response 的 `persistence` 字段里，独立接口作为后续增强。

### 下载线上数据备份

V1 可用同步下载：

```http
GET /api/share-deployments/{deploymentId}/persistence/archive
```

返回：

```http
Content-Type: application/zip
Content-Disposition: attachment; filename="shr_xxx-persistence-20260709-153000.zip"
```

如果数据较大或打包耗时，升级为异步任务：

```http
POST /api/share-deployments/{deploymentId}/persistence/export
GET /api/share-deployments/{deploymentId}/persistence/export/{taskId}
```

### 清空线上数据

```http
POST /api/share-deployments/{deploymentId}/persistence/clear
Content-Type: application/json

{
  "confirmText": "清空线上数据"
}
```

服务端行为：

- 校验当前用户拥有该 deployment/share。
- 只删除该 share 的 `persistence_remote_root` 下的数据。
- 不删除 NAS 全局目录。
- 写入事件日志。

### 用本机数据替换线上数据

覆盖可以复用部署接口，通过 manifest 增加 `redeployPolicy=overwrite_remote`。

如果需要单独操作：

```http
POST /api/share-deployments/{deploymentId}/persistence/import
Content-Type: multipart/form-data

archive=<zip>
mode=overwrite_remote
confirmText=替换线上数据
```

V1 建议优先通过“重新部署 + overwrite_remote”完成，避免新增过多服务端路径。

## 服务端运行时策略

当前 `run.sh` 已经实现 `keep_remote` 语义：

1. NAS 目标不存在：复制包内 seed 数据。
2. NAS 目标存在：不覆盖。
3. 删除 runtime 本地路径。
4. 创建软链指向 NAS。

需要新增 `overwrite_remote` 时，运行时逻辑可扩展：

```sh
if [ "$LOBSTER_PERSISTENCE_REDEPLOY_POLICY" = "overwrite_remote" ]; then
  rm -rf "$PERSIST_TARGET"
fi
```

注意：

- 删除必须限制在 `PERSIST_ROOT` 内。
- 对文件和目录分别处理。
- 覆盖前建议服务端先备份，至少保留最近一次。

## 安全和权限

客户端校验：

- 禁止选择项目外路径。
- 禁止 `.env`、密钥、隐藏配置。
- 禁止 `node_modules` 和构建产物。
- 禁止符号链接。

服务端必须重复校验：

- `appPath`、`dataPath` 必须是安全相对路径。
- 不允许绝对路径。
- 不允许 `..`。
- 不允许空路径。
- 不允许超过最大绑定数。
- 不允许超过单部署配额。

下载权限：

- 只有分享拥有者可以下载线上数据备份。
- 管理员接口必须走后台权限。
- 下载链接不能长期公开，若使用临时 URL，必须短 TTL。

日志要求：

- 不打印完整线上数据内容。
- 不打印 zip 下载临时签名 URL。
- 只记录路径、大小、任务状态。

## 数据空间

V1 默认单部署服务数据空间：

```text
100 MiB
```

客户端展示为：

```text
数据空间 100 MB
```

行为：

- 部署前按本地选择项大小做静态提示。
- 线上真实用量由服务端估算或定期扫描。
- 超额时服务端拒绝写入或部署，并返回可读错误。

V1 不做用户自定义额度。后续可按套餐或后台配置下发。

## 错误处理

### 下载失败

提示：

```text
线上数据备份下载失败，请稍后重试。
```

详情展开显示服务端错误。

### 路径不存在

如果缓存的本地路径不存在：

```text
上次选择的 data/ 不存在，已取消选择。
```

### 线上无数据

```text
线上还没有服务数据。首次部署后，服务写入的数据会保存在这里。
```

### 替换风险

替换线上数据必须二次确认，并要求输入固定确认文本。

## 分阶段实施

### Phase 1：部署前选择

- `nodeServiceProjectAnalyzer` 输出候选项。
- 部署确认弹窗默认展示 `服务数据 已自动保护` 或 `服务数据 未开启`。
- 用户点击 `查看保存内容` 后可勾选/取消、添加项目内路径。
- 生成现有 `manifest.persistence`。
- 缓存用户选择。

### Phase 2：服务详情管理

- 服务详情展示 `服务数据` 面板。
- 支持下载线上数据备份 zip。
- 支持下载后保存到 `.lobster/persistence/...`。
- 支持“在 Finder 中显示”。

### Phase 3：高危操作

- 支持清空线上数据。
- 支持用本机数据替换线上数据。
- 支持替换前本地备份。
- 增加操作事件日志。

### Phase 4：迁移增强

- 本地数据文件识别后显示迁移引导。
- 支持下载线上数据备份后“一键复制到项目路径”。
- 支持迁移前后本地差异提示。

## 本地 API 和功能测试要求

所有涉及火山云 API、veFaaS、TOS、VPC、NAS 挂载或 NAS 数据读取的改动，合入前必须在本地跑真实 API 测试，不能只依赖 mock。

必须覆盖：

1. OpenAPI smoke test：调用真实 veFaaS `ListFunctions`，验证 AK/SK、签名、区域和 OpenAPI endpoint。
2. NAS 功能测试：用 `/Users/admin/lobsterai/project/brotato-clone` 打包部署，写入排行榜，重新部署同一个 share 数据根目录，再验证新函数可以读到旧排行榜数据。
3. 上传路径测试：brotato 默认走 TOS 上传。direct zip 只能用于小包验证，因为 zip base64 后会膨胀，较大的 JSON body 可能触发 OpenAPI request parsing error。

推荐命令：

```bash
# 真实 OpenAPI smoke test，不创建云资源。
SHARE_DEPLOYMENT_VOLCENGINE_API_TEST=true \
SHARE_DEPLOYMENT_VOLCENGINE_CREDENTIAL_JSON='{"accessKeyId":"...","secretAccessKey":"..."}' \
./gradlew test --tests com.youdao.lobsterai.service.sharedeployment.VolcengineVefaasCloudIntegrationTest.listFunctionsThroughVolcengineOpenApiClient --rerun-tasks

# brotato-clone 端到端 NAS 功能测试，会创建临时函数并在结束后清理。
SHARE_DEPLOYMENT_BROTATO_PERSISTENCE_CLOUD_TEST=true \
SHARE_DEPLOYMENT_VOLCENGINE_CREDENTIAL_JSON='{"accessKeyId":"...","secretAccessKey":"..."}' \
./gradlew test --tests com.youdao.lobsterai.service.sharedeployment.VolcengineVefaasCloudIntegrationTest.deployBrotatoProjectWithNasPersistenceAndRedeployKeepsLeaderboard --rerun-tasks
```

测试通过条件：

- API smoke test 不跳过，且 `BUILD SUCCESSFUL`。
- brotato 测试不跳过，且完成函数创建、排行榜写入、二次部署、读取旧排行榜。
- 测试结束后临时函数被清理；如果设置 `SHARE_DEPLOYMENT_CLOUD_TEST_KEEP_FUNCTION=true`，必须在人工验证后手动删除。

## 验收标准

1. 对 `/Users/admin/lobsterai/project/brotato-clone` 这类项目，部署前默认看到 `服务数据 已自动保护`。
2. 点击 `查看保存内容` 后能看到 `data/`，文案为“可能包含排行榜、问卷结果或服务数据”。
3. 用户取消 `data/` 后，manifest 不包含 `persistence` 配置。
4. 用户选择 `data/` 后，部署 response 返回 `persistence.enabled=true`。
5. 线上写入排行榜后，更新服务仍保留排行榜数据。
6. 点击 `下载线上数据备份` 后，本地生成 `.lobster/persistence/<shareId>/<timestamp>/`。
7. 本地数据文件被选择时，部署确认弹窗显示“数据保存方式发生变化”的迁移提示，不默认出现 SQLite/schema。
8. 用本机数据替换线上数据或清空线上数据必须二次确认。
9. 用户无法选择项目外路径、`.env`、`node_modules`。

## Open Questions

1. 下载线上数据备份是否需要支持只下载单个保存项，还是 V1 下载整个 share 数据目录即可。
2. 线上用量统计是部署时计算、按需扫描，还是后台定时扫描。
3. 删除分享时是否提供“同时删除线上数据”的选项，默认建议不删除。
4. `overwrite_remote` 是通过部署接口实现，还是单独提供 import API。
