# DX OS 协议接入 · 完整作业手册

> 本文件是 SKILL.md 的展开版：从零把一家上游 API 接进 DX OS 的完整流程。
> 内容取自《DX-OS-协议接入-通用提示词》并经真机源码核对；标注「已验」的条目在 runtime-0.3.3 源码中确认过。

## 0. 这份手册的用法

把「第一步 ~ 交付要求」整段当作流程走。**手册（上游对接文档）是唯一的接口真源**：写了的能力才声明，没写的绝不猜。
动手前先读完「硬约束」和「自检」两节 —— 尤其是硬约束第 11 条，它不会让任何校验报错，只会在界面上悄悄少一格。

## 1. 定位环境（不要猜路径，先找出来）

```bash
# 1) DX OS 便携版根目录（含 DX OS.exe 与 dx-os-portable.json）
ls -d /*/DXOS-Portable-*-win-x64 /*/*/DXOS-Portable-*-win-x64 2>/dev/null

# 2) 运行时是「多版本 + 自动升级」结构，取版本号最大的那个
ls -d "<DXOS根目录>"/.dx-runtime/versions/runtime-* | sort | tail -1
```

| 要找什么 | 位置 |
|---|---|
| 数据目录 | `<DXOS根目录>/data`（以 `dx-os-portable.json` 的 `dataDirectory` 为准） |
| 协议仓库 | `data/custom-protocols-v2.json` |
| 站点配置 | `data/providers.json`（**是一个数组**，不是对象） |
| 服务端源码（TS 原码可读） | `<最大 runtime>/resources/app.asar.unpacked/server/` |
| 画布前端（压缩 JS） | `data/developer-apps/.versions/canvas/<最大版本>/source/assets/index-*.js` |

**动手改任何数据文件前先备份**：

```bash
cp data/custom-protocols-v2.json "data/custom-protocols-v2.json.bak-$(date +%Y%m%d-%H%M%S)"
cp data/providers.json          "data/providers.json.bak-$(date +%Y%m%d-%H%M%S)"
```

## 2. 把手册读成一张「接口事实表」

**先只读手册、不动任何文件**，把下面这些一条条抄出来。抄不到的明确标「手册未写」，然后来问用户 —— **不要用经验填空**。

| 要提取的事实 | 为什么需要 |
|---|---|
| 鉴权方式（Bearer / 自定义 Header / 查询参数） | 平台协议的 `auth` |
| Base URL，以及它本身有没有 `/v1` 之类的版本段 | 所有 `path` 要不要带版本段 |
| 是**同步**（一个请求直接出结果）还是**异步**（提交拿 ID → 轮询） | 决定要不要 `poll` |
| 提交端点、请求方法、`Content-Type`（JSON 还是 multipart） | `operations.<submit>` |
| 结果查询端点、路径里任务 ID 的占位样貌 | 轮询路径必须与之同名 |
| 素材上传端点（有没有、字段名、返回什么键） | `workflow.uploads` + `assets` |
| **请求字段的准确名字与别名**，以及哪个是「实际生效」的那个 | `bodyTemplate` —— 用错别名会被上游静默忽略 |
| 返回体里：任务 ID 键名、状态枚举、成片/图片直链键名、错误信息键名 | `response` 映射 |
| 模型清单，逐个记录：时长范围或固定值、宽高比、分辨率、各素材数量上限、是否必须带图、是否出声 | `modelProfiles` + `uiSchemas` + `limits` |
| 哪些能力明确支持（文生 / 图生 / 首尾帧 / 多参考 / 视频参考 / 音频参考 / 音频 / 图片） | `capabilities` |
| 素材是「公网 URL」还是「需先上传」，本地文件能不能直传 | `assets.mode` |

把这张表先发给用户确认，再开始写 JSON。

## 3. 写两份协议（只输出 JSON，禁止脚本）

`schemaVersion` 固定 `"dx-protocol/v2"`。**只有 JSON，不能有 script / eval / 函数体 / Shell**，
复杂逻辑用声明式原语拼：`$map` / `$concat` / `$merge` / `$coalesce` / `$cardinality` /
`$dataUrlBase64` / `$keyValue` / `$file` / `$files`，配合 `omitEmpty`。

### 3.1 平台协议（`kind = "provider"`）

**只写三件事**：鉴权、公共 Header、模型目录。不要在这里写业务请求体。

```json
{
  "schemaVersion": "dx-protocol/v2",
  "kind": "provider",
  "id": "<平台id>",
  "auth":    { "type": "bearer", "credentialRef": "api_key" },
  "headers": { "Accept": "application/json" },
  "models":  { "method": "GET", "path": "/v1/models", "response": { "data": "$.data" } }
}
```

- **绝不把真实令牌写进协议文件**：用 `credentialRef` 引用，令牌由用户在界面里填。
- 鉴权不是 Bearer 的（自定义 Header 名、或 key 放 query）→ 按手册如实改 `auth`。
- 已验：`models` 是 **schema 必填**（`types.ts:149`）。手册没写模型列表端点也要补一条，否则安装直接失败。

### 3.2 模型协议（`kind = "model"`）

这是**请求执行的唯一真源**。要点：

- `capabilities` 只能用真实 Intent 枚举，例如视频：`video.text_to_video` / `video.image_to_video` /
  `video.first_last_frame` / `video.multi_reference` / `video.video_to_video` / `video.audio_reference`；
  图片用 `image.generate` / `image.edit`；音频用 `audio.tts` / `audio.music`。
- `operations`：提交 / 轮询 / 上传，`path` 按手册写全（含版本段）。
- `workflows`：**每个 Intent 一条**，串起 `uploads` → `submit` → `poll` → `result`。
  同步接口没有 `poll`，`result` 直接指向提交响应里的键。
- `response` 里任务 ID / 状态 / 错误必须映射到约定键名：
  `taskId` / `status` / `progress` / `errorCode` / `errorMessage`（只有这几个会被持久化），
  结果直链声明为 `resultUrl` / `resultUrls`。
- `uiSchemas` + `modelProfiles` + `limits`：见硬约束 10~15。
- **一个平台的不同能力（图片 / 视频 / 音频 / LLM）要拆成多个模型协议**，不要塞进一个。

**动手前先读范例**：`server/protocol-engine/builtins.ts` 里有大量同类平台的现成写法（uploads 用法、`$cardinality` 分支、`uiSchemas`、`limits`）。**抄结构，别凭想象写。**

## 4. 硬约束（全部来自 DX OS 本身，逐条别跳）

1. **权限分工**：平台协议只管鉴权 / 公共 Header / 模型列表；模型协议是请求的唯一真源。同一平台不同能力拆成不同模型协议。
2. **`inputs` 只有四个固定分组**：`images` / `videos` / `audios` / `files`。
   手册里的「首帧 / 尾帧 / 参考图」在 DX OS 里是**素材的 `role` 字段，不是分组**。
   写 `{{inputs.first_frame}}` → 求值 UNDEFINED → 报 **`$map.from 必须渲染为数组`**。
   首尾帧正确做法：用 `{{inputs.images[*].url}}` 配合 `{{inputs.images[0].url}}` / `{{inputs.images[1].url}}` 按下标取。
3. **`$map` 只允许 `from` + `template`，且 `from` 必须渲染成数组**。
   路径含 `[*]` 才返回数组，否则是标量：`{{inputs.images}}` 是数组对象，`{{inputs.images[*].url}}` 是 URL 数组。
4. **模板变量根名有白名单**：`model | prompt | params | inputs | provider | captures | derived`。
   `{{items[0]}}` / `{{items.0}}` **非法**（校验器按 `split('.')[0]` 取根名），要按下标取就写 `{{inputs.images[0].url}}`。
5. **可选素材字段用 `$cardinality`**（`zero: {}` / `one` / `many`），不要用裸通配表达式，否则空数组会污染请求体。配合 `omitEmpty: true` 逐层剥离 `undefined / null / '' / [] / {}`。
6. **轮询路径的参数名必须与 `response.taskId` 同名**（通常写 `{taskId}`）。名字对不上会残留 `<capture:...>` → 抛「协议请求仍包含未解析的 capture」。`pathParams` 不是 v2 字段。
7. **所有 `path` 写全、含版本段**（如 `/v1/...`）。`joinUrl()` 会自动去掉重复的版本段，写全最稳。
8. **`workflow.uploads` 是素材上传的唯一机制**。`workflow.steps` 是不存在的字段 —— **写了不报错，也不上传，本地文件会静默丢失**。
   `result.source` 必须是上传 operation `response` 里已声明的键；`result.target` 只能是 `url` 或 `remoteName`。已验（`types.ts:95`）。
9. **`assets.mode` 决定本地文件能不能用**：
   - `upload_operation`：协议自己上传（**最通用**，本地文件 + 公网 URL 都能接）
   - `data_url`：内联 base64 提交
   - `public_url`：只收公网 http(s)，**本地文件会被判 null，任务静默回落到旧链路**
   - `remote_name`：上游只认文件名
10. **`uiSchemas` 的值必须是「字段数组」**：
    ```json
    "uiSchemas": {
      "my-params": [
        { "key": "duration", "label": "时长", "type": "number", "default": 5, "min": 1, "max": 30, "step": 1 }
      ]
    }
    ```
    写成 `{ "duration": {...} }` 这种「字段名字典」→ 不是数组 → `resolveParameterSchema` 返回 null → **参数面板一格都不显示**（但覆盖率仍全绿）。
    Profile 用 `"uiSchemas": ["my-params"]` 按 id 引用。
    字段键是 `key`（不是 `param`），选项是 `options: [{label, value}]`。
    合法 `type`：`select | number | slider | toggle | text | textarea | json`。
    另：源码里还有一个未见于文档的 `showWhen: { models: [...] }`，可按模型控制某格显隐（`protocolManifest.ts:353`）。
11. **【最容易漏】界面上每一格都是「单独判存在性」，少一个字段就少一格。**
    DX OS 画布视频节点的工具条按固定顺序渲染：
    ```
    [模式按钮] [生成音频] [时长] [画面比例] [分辨率] [更多参数]
    ```
    它逐个用「参数 schema 里有没有这个 key」来决定这一格画不画，**找不到就整格不渲染**。
    所以只要模型面板需要这几格，`uiSchemas` 里就必须同时有：
    `duration`、`aspect_ratio`、`resolution`、`generate_audio`
    （画布的视频白名单是 `prompt / duration / aspect_ratio / size / resolution / generate_audio`；
    不在名单里的字段会落进「更多参数」弹层，比如 `seed`、`watermark`、`skip_review`）。
    ⚠️ **这种「少一格」不会让任何校验报错**：结构校验通过、覆盖率 100%、执行模拟全过，界面上照样缺。
    所以 `uiSchemas` 的字段集合每次改动，都必须按第 6 节「第 4 层」逐格核对。
    另注：`limits.features[key] = false` 是把字段**删掉**（`protocolManifest.ts:99` 返回 `[]`），不是置灰。
12. **`limits.references` 必须嵌套**：`"references": { "images": { "max": 9 }, "videos": { "max": 3 }, "audios": { "max": 3 } }`。
    写成平铺的 `limits.images` 不会被任何代码读到 → 张数上限形同虚设。已验（`modelDescriptor.ts:60,73` 读的是 `object(limits.references)[kind]`）。
    固定档位写 `{ "options": [15], "default": 15 }`；`{ "fixed": 15 }` / `{ "enum": [...] }` 是自造键，不被识别。
13. **`limits` 是 Profile 级的，不是单个模型级的**。一条 Profile 覆盖多个取值不同的模型时，面板只能显示一个默认值（会把高配模型显示成低配值）。
    → 按「同一组取值」把 Profile 拆开，保证一条 Profile 只对应一组一致的参数；
    取值被型号固定的（比如分辨率写在型号名里）写 `{ "options": ["720P"], "default": "720P", "readonly": true }`。
14. **`modelProfiles` 用字典形态**（`{ "profileId": {...} }`），写成数组会导致 Profile 校验被静默跳过；
    `profile.workflows` 也要写成字典（`{ "<intent>": "<workflowId>" }`）。
15. **Profile 匹配是「前缀命中 + 取第一个」**：模型名只要以某个 `match` 值**开头**就算命中。
    → **笼统档必须排在具体型号之后**，否则具体型号会被笼统档冒名接管（能力、参数、限额全错，但覆盖率依然全绿）。
16. **只声明手册里明确写了的能力和参数**。手册没写的宁可留 `missing`，也不要按模型名字或经验猜。确实要兜底就单独建一条 Profile，方便一键删除。
17. **手册里给了别名（如 `ratio` / `aspect_ratio` 二者等价）时，选手册标注「推荐 / 实际生效」的那个**，其余别名当作兼容候选写进 `$coalesce`，别把多个别名同时下发。
18. **不写真实令牌、真实用户数据**进任何协议文件。
19. **改完协议必须重启 DX OS**：`protocol-engine/repository.ts` 的 `ensureLoaded()` **只读一次并缓存**（第 71-73 行）；而 `providers.json`（站点配置）每次都重读文件，可以热改。**写入协议仓库前必须先退出 DX OS**，否则它可能在自己的保存流程里覆盖你的改动。
20. 涉及时间戳 / 数值一律用命令取（如 `date`），不要自己算。
21. 异步任务建议 5 秒轮询一次并设置最长等待；上游返回 `failed` 时优先读错误字段（不同上游的失败键名可能不止一种，`$coalesce` 多路兜底）。

## 5. 离线 harness（动真实环境之前必须先离线跑通）

DX OS 的 `server/protocol-engine/*.ts` 只依赖 `node:*`，**可以脱离 Electron 直接跑**。先搭一个离线 harness：

```bash
SRC="<最大 runtime 目录>/resources/app.asar.unpacked/server"
mkdir -p /tmp/dxv/protocol-engine && cd /tmp/dxv
cp "$SRC"/protocol-engine/{validator,types,compiler,workflow,transport}.ts protocol-engine/
cp "$SRC"/capabilityTypes.ts .
cp "$SRC"/protocolManifest.ts .
# protocolManifest.ts 依赖 ./protocols.ts 与 ./protocol-engine/repository.ts → 写两个最小替身：
#   protocols.ts                  : export const PROTOCOLS = {}; export const PROVIDER_PROTOCOLS = {};
#   protocol-engine/repository.ts : 读命令行/环境变量指定的协议 JSON 直接返回（等价于「仓库里只有一个激活版本」）
```

**必须用 `--experimental-transform-types`**；用 `--experimental-strip-types` 会报
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not supported`。

> 已有现成实现：本 skill 的 `bin/verify-protocol.mjs` 覆盖了第 1、2 层（schema + 编译 + 素材探针），
> `bin/assert-param-guards.mjs` 覆盖取值断言，`bin/protocol-hash.mjs` 覆盖 hash 与仓库体检。
> 只有在需要**真的模拟「上传 → 提交 → 轮询」多步链路**时才需要自建 harness。

## 6. 四层验证（每层都要过）

**① 结构校验 + hash**
调 `validateProtocolV2(json)`。hash 算法 = 对象按 key `localeCompare` 排序、数组保序，拼成 `{"k":v}` / `[a,b]` 后 sha256。
本地算出的 hash 若等于仓库里某版本的 hash，说明复现忠实。（本 skill 的 `bin/protocol-hash.mjs` 已与官方实现逐字节一致。）

**② 编译 + 执行模拟（最有价值）**
用假 transport 跑「上传 → 提交 → 轮询」全链路，打印每一步的真实 URL 与请求体。
**这是唯一能在不发真实请求的前提下发现渲染期报错的手段** —— `$map.from 必须渲染为数组` 就是被它抓出来的，而结构校验完全查不出。
至少覆盖：每个 `capabilities` 各一条 + 「本地文件（走上传）」和「公网 URL（免上传）」两条素材路径。

**③ UI 描述符**
对站点里每个真实模型调 `resolveParameterSchema(protocolId, model, intent)`，确认：
意图映射是**显式声明**的（不是靠同名 workflow 兜底）、参数面板非空、命中的 Profile 正确。

**④ 界面逐格核对（专治「少一格」）**
对每个模型逐一确认这几格都会出现：`duration` / `aspect_ratio` / `resolution` / `generate_audio`。
判定逻辑等价于：`schema.fields.filter(f => f.key && f.key !== 'prompt')` 里能否 `find` 到该 key
（`aspect_ratio` 也接受别名 `ratio` / `size`；`camera_fixed` 接受 `camerafixed`）。
候选档位：字段 `options` 优先；没有则 duration 按 `min..max/step` 展开、
resolution 兜底 `['', 480p, 720p, 1080p]`（空串显示为「自动」）。

## 7. 写入与生效

1. **退出 DX OS**（Electron 主进程不吃优雅关闭，要强制）：
   ```bash
   MSYS_NO_PATHCONV=1 taskkill /F /IM "DX OS.exe"
   ```
   > Git Bash 下不加 `MSYS_NO_PATHCONV` 会把 `/IM` 当路径；不加 `/F` 对 Electron 主进程无效。
2. 备份 → 往 `data/custom-protocols-v2.json` 写入新协议（`provider` / `model` 两个桶各自独立）。
   版本条目形如 `{ "version": N, "hash": "<sha256>", "createdAt": "...", "protocol": {...} }`，并设置 `activeVersion`。
   ⚠️ **`hash` 必须正确**：`parseEntry` 会校验 hash（`repository.ts:60`），对不上就**静默丢弃整个版本**（表现为「导入成功但版本没出现」）。
   写出格式保持 `JSON.stringify(store, null, 2) + "\n"`。已存在同 hash 版本时只把它设为 active，否则版本号 = 现有最大值 + 1。
3. 配站点（改 `data/providers.json`，或在界面「API 设置」里做）：
   - 站点：名称、`base_url`、`protocol` = 平台协议 id、**用户自己的令牌**填在 `api_key`
   - 每个模型：`protocol` 必须指向**模型协议 id**（不是站点协议 id），`caps` 填能力类型
4. **重启 DX OS** → 检查站点里每个模型状态应为 `ready`、覆盖率 100%。
5. 画布上新建节点，逐个模型切换，确认工具条每一格都在、值正确。
6. 真跑一条最短任务（最小参数）确认端到端可用。

## 8. 交付要求（这些必须做到）

- 说明改动了哪些文件（**绝对路径**）
- 先发那张「接口事实表」，确认无误再动手写 JSON
- 贴出四层验证的结果，尤其**第 2 层打印的真实请求体**和**第 4 层的逐格结论**
- 明确列出**没有**做到的部分、以及手册里没写清楚的地方 —— **不要含糊带过，不要假装完成**
- 卡住就如实说卡在哪、报什么错、已经排除了哪些原因

## 9. 参考：DX OS 关键源码位置

| 想确认什么 | 去读 |
|---|---|
| 结构合法性规则（哪些字段合法、哪些会被拒） | `server/protocol-engine/validator.ts` |
| 模板渲染、`$map` / `$cardinality` / `joinUrl` 的真实语义 | `server/protocol-engine/compiler.ts` |
| 上传、延迟引用、轮询、结果解析 | `server/protocol-engine/workflow.ts` |
| 协议类型定义（哪些字段必填） | `server/protocol-engine/types.ts` |
| 协议仓库读写、hash 校验、缓存策略 | `server/protocol-engine/repository.ts` |
| 参数面板、`limits` 如何作用到字段、Profile 匹配 | `server/protocolManifest.ts` |
| 模型描述符、意图映射 | `server/modelDescriptor.ts` |
| 素材交付模式分支 | `server/ai-tasks/declarativeRouter.ts`、`assetResolvers.ts` |
| **内置协议范例（写之前一定先看）** | `server/protocol-engine/builtins.ts` |
| 界面工具条逐格渲染逻辑 | `data/developer-apps/.versions/canvas/<ver>/source/assets/index-*.js` |
