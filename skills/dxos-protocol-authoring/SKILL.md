---
name: dxos-protocol-authoring
description: 编写、修复、校验 DX OS（本地桌面版）自定义协议 JSON（平台协议 provider + 模型协议 model，schemaVersion dx-protocol/v2），以及把上游 API 完整接进 DX OS。当要为新 API 站点写协议、要接入/导入协议到 DX OS、协议报 400/「输出类型 undefined」/「没有标准化输出」/「协议请求仍包含未解析的 capture」/selector 或模板校验失败、界面参数少一格（时长/比例/分辨率/生成音频不显示）、UI 选的参数（分辨率/比例/时长/尺寸）上游不认需要兜底、选了「原图比例」却出正方形、选了 2K 却是别的尺寸、导入后协议版本不出现，或要排查 DX OS 里某次 AI 任务的真实请求体时使用。
agent_created: true
---

# DX OS 自定义协议：编写 / 修复 / 接入 / 真机校验

DX OS 是本地桌面应用，协议是声明式 JSON（`schemaVersion: "dx-protocol/v2"`），由运行时里的纯函数编译器编译成执行计划。
本 skill 的核心价值：**别靠猜，直接调用 DX OS 自己的 protocol-engine 把协议编译一遍**，看最终发给上游的 body。

> 完整的「从零接入一家上游」作业手册（含接口事实表模板、离线 harness 搭建、四层验证、交付清单）见
> `references/onboarding-playbook.md`。本文件是可执行清单 + 已实测的坑。

## 一、环境定位（先找，不要猜路径）

```bash
# DX OS 便携版根目录（含 DX OS.exe 与 dx-os-portable.json）
ls -d /*/DXOS-Portable-*-win-x64 /*/*/DXOS-Portable-*-win-x64 2>/dev/null
# 运行时是多版本结构，取版本号最大的那个
ls -d "<DXOS根目录>"/.dx-runtime/versions/runtime-* | sort | tail -1
```

| 要找什么 | 位置 |
| --- | --- |
| 数据目录 | `<DXOS根目录>/data`（以 `dx-os-portable.json` 的 `dataDirectory` 为准） |
| 协议仓库 | `data/custom-protocols-v2.json` |
| 站点配置 | `data/providers.json`（**是数组，不是对象**） |
| 任务库（真实请求体） | `data/protocol-tasks.db` |
| 服务端源码（TS 原码可读） | `<最大 runtime>/resources/app.asar.unpacked/server/` |
| 内置协议范例（写前必看） | `.../server/protocol-engine/builtins.ts` |
| 画布前端（压缩 JS） | `data/developer-apps/.versions/canvas/<最大版本>/source/assets/index-*.js` |

**动任何数据文件前先备份**：`cp data/custom-protocols-v2.json "data/custom-protocols-v2.json.bak-$(date +%Y%m%d-%H%M%S)"`（`providers.json` 同理）。

## 二、作业流程

0. **只读手册，先产出「接口事实表」**：鉴权方式、Base URL 有无 `/v1` 段、同步还是异步、提交/查询端点与方法、`Content-Type`、任务 ID 占位样貌、素材上传端点、**请求字段的准确名与别名（哪个真正生效）**、返回体键名（ID/状态/直链/错误）、模型清单（时长/比例/分辨率/素材上限/是否必须带图/是否出声）、支持的能力枚举、素材是公网 URL 还是需先上传。抄不到的标「手册未写」**并来问用户，不要用经验填空**。事实表先发用户确认，再写 JSON。
1. 写两份 JSON（见第三、四、五节）。同一平台的不同能力（图片/视频/音频/LLM）**拆成多个模型协议**。
2. 离线校验：`verify-protocol.mjs`（schema + 编译）+ `assert-param-guards.mjs`（取值白名单）+ `probe-local-input.mjs` / `probe-ratio.mjs` / `probe-panel.mjs`（按协议类型选跑，见第七节）。
3. 退出 DX OS → 备份 → 写入 `custom-protocols-v2.json`（hash 必须对，见第八节）。
4. 配 `providers.json`：站点 `protocol` = **平台协议 id**；每个模型 `protocol` = **模型协议 id**，`caps` 填能力。
5. 重启 DX OS → 模型状态应 `ready`、覆盖率 100% → 画布逐格核对面板 → 真跑一条最小任务。
6. 交付时列明改动的**绝对路径**、四层验证结果、**没做到的部分和手册没写清的地方**（不要含糊带过）。

## 三、硬约束速查表（0.3.3 实测，写错多半静默失败）

| 规则 | 说明 |
| --- | --- |
| `workflow.result.kind` | **必填** `image`/`video`/`audio`，缺了报「产物 MIME 与输出类型 undefined 不匹配」 |
| 模型协议 `id` == 平台协议 `id` | 不相等不会自动绑定 |
| provider 的 `models` | **必填**（`types.ts:149` 非可选）。缺了报三条：`models.method 不受支持` + `models.path 必须是相对路径、HTTPS，或 localhost HTTP` + `models.response 缺失`。标准写法 `{ "method": "GET", "path": "/v1/models", "response": { "data": ["$.data", "$.models"] } }` —— 手册没写模型列表端点也要补，这是 schema 硬要求 |
| operation id | 必须匹配 `/^[a-z0-9][a-z0-9:_-]{1,63}$/`，即**全小写**。`faceStyle` 这类驼峰报「operation id 无效」，改完记得同步 workflow 里的 `submit` 引用 |
| `$cardinality` | 必须含 `from` `zero` `one` `many`，只能额外含 `two`；少一个 `one` 直接校验失败。分支内可用 `item`（首项）与 `items`（整个数组） |
| `inputs` 只有四个分组 | `images` / `videos` / `audios` / `files`。手册里的「首帧/尾帧/参考图」是素材的 `role` 字段，**不是分组**。写 `{{inputs.first_frame}}` → 求值 UNDEFINED → 报 **`$map.from 必须渲染为数组`**。首尾帧正确做法：`{{inputs.images[*].url}}` 配 `{{inputs.images[0].url}}` / `{{inputs.images[1].url}}` 按下标取 |
| **图片语义：参考图 vs 首帧** | 上游 `images` 每项**带不带 `type`** 决定约束强弱，各站不同：不带 = 参考图（弱），`type=first_frame` = 图生视频首帧（强）。DX OS 对**单图 i2v 只给 `role: reference_image`、从不给 `first_frame`**（`index.ts:3248-3252`），且模板层**没有 lookup**，无法按 role 条件省略字段 → 必须**按 intent 拆 operation**、用 `$map` 显式构造。漏掉这步的典型症状 = 用户说「**结果没遵循参考图**」。详见 5.2 |
| `$map` | 只允许 `from` + `template`，且 `from` 必须渲染成**数组**（路径含 `[*]` 才是数组） |
| 模板变量根名白名单 | `model prompt params inputs provider captures derived`。`{{items[0]}}` / `{{items.0}}` **非法**（校验器按 `split('.')[0]` 取根名），要按下标取就写 `{{inputs.images[0].url}}` |
| 模板正则 | `^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[(?:\*|\d+)\])*$` |
| 素材数组 | body 里要字符串数组时写 `{{inputs.images[*].url}}`；裸 `{{inputs.images}}` 渲染成**对象数组** → 上游报 `must be an array of strings` |
| `$map` 的 `from` / `$files` | 必须保留**裸引用** `{{inputs.images}}`（要对象数组，`item.dataUrl`/`item.mime` 才可用），不要批量替换成 `[*].url` |
| 素材规则 `assets.<kind>.mode` | Canvas 默认的本地素材**只有 `dataUrl`**（`canvasAssets.ts:58-68`）。图片类一律 `data_url` + 读 `{{inputs.images[*].dataUrl}}`；写 `public_url` 会让本地图生图直接 409 `unsupported_local_input`（详见第五节 5.1） |
| path 占位符 | `{taskId}` 里的键名必须 == `response` 捕获键名（`taskId`），**不是上游字段名**。名字对不上会残留 `<capture:...>` → 报「协议请求仍包含未解析的 capture」。`pathParams` 不是 v2 字段 |
| selector | 只认 `$.data[*].url` / `$.data[0].url` / `$[*]`；**空方括号 `$.data[].url` 完全不被解析** |
| `path` 写全 | 所有 `path` 含版本段（如 `/v1/...`）。`joinUrl()` 会自动去掉重复的版本段，写全最稳 |
| `workflow.uploads` | 素材上传的**唯一机制**。`workflow.steps` 是不存在的字段 —— **写了不报错也不上传，本地文件静默丢失**。`result.source` 必须是上传 operation 的 `response` 里已声明的键；`result.target` 只能是 `url` 或 `remoteName` |
| 响应映射键名 | 只有 `taskId` / `status` / `progress` / `errorCode` / `errorMessage` 会被持久化；结果直链声明为 `resultUrl` / `resultUrls`。不同上游失败键名可能不止一种，用 `$coalesce` 多路兜底 |
| `omitEmpty: true` | 逐层剥离 `undefined / null / '' / [] / {}` |
| `params` 合并顺序 | `{...profile.defaults, ...task.params}` —— **任务侧参数覆盖 defaults**，所以 UI 传什么就是什么（这正是第六节串台 bug 的成因） |
| 画布比例的取值 | 选「原图比例」时发的是 **GCD 约分后的具体比**（如 `1055:1491`，不是字面量 `source`）；分辨率一律**小写** `1k/2k/4k`。所以：①`lookup` 的 `cases` 只认字面量精确匹配，非枚举值要么给 `fallback`、要么原样透传（上游就近映射）；②分辨率若直接透传给枚举型上游 = **静默失效**（上游要大写 `2K`）。三种归宿与实测判据见第六节 |
| 条件分支 | 引擎没有 `if`。模板层用 `$coalesce`（取第一个渲染后非空的结果）+ `$keyValue`（key 为空串时返回 `UNDEFINED`）组合成开关；`lookup` 的 `fallback` 不给值时返回 `undefined`，可让某个字段在请求里整个消失（如 `image_size` 缺省 → 上游用 auto） |
| 异步任务 | 建议 5 秒轮询 + 最长等待；`failed` 时优先读错误字段 |
| **真实 apiKey 禁止入库** | provider 段的 `apiKey` 一律写占位符 `YOUR_API_KEY`；真实密钥填进 DX OS 界面或落在被忽略的 `*.local.json`。本仓库有 `.gitignore` + `hooks/pre-commit` + `scripts/scan-secrets.mjs` 三道防线。**已提交过的密钥视为已泄漏，必须吊销重签** |
| **异步任务重试** | **只在 operation 上写 `retry` 才生效**（`compiler.ts:351` 把 `operation.retry` 拷进编译后的 request，`workflow.ts:237-256` 消费它）。不写 `retry.retryNetwork: true` 时 `totalAttempts` 默认 1 且网络错误**不重试** → **一次瞬时 `fetch failed` 就把已经提交成功的异步任务永久判死**。异步视频/图片必写；轮询 `poll` 也要配 `backoff`/`maxIntervalMs`/`maxDurationMs`（只写 `intervalMs` 时上限回落到默认 30 分钟） |
| 别名 | 手册给了别名（`ratio` / `aspect_ratio` 等价）时选标注「推荐/实际生效」的那个，其余当兼容候选写进 `$coalesce`，**别同时下发多个别名** |
| 时间戳 | 一律用命令取（`date`），不要自己算 |
| **`label` 命名** | 协议顶层 `label` 是**给用户看的显示名**，一律用中文，格式 `<平台中文名> <类型>`（**平台名与类型之间留一个空格**）：<br>· provider → `<平台中文名> 平台`（如 `佳速API 平台`）<br>· model 顶层 → `<平台中文名> <类型>模型`（如 `佳速API 视频模型` / `七牛 Modelink 图片模型`）<br>· `modelProfiles.<id>.label` → `<平台中文名> <类型>`（如 `佳速API 视频`）<br>**例外**：档案 label 若本质是**上游模型名**，保持英文原样（`GPT Image 2` / `Gemini 3 Pro Image` / `MiniMax H3` / `Seedance 2.5`）—— 翻译反而对不上上游，不要硬翻。<br>平台中文名**必须从该站接入文档/官网核实**，不要从域名音译硬凑（曾把 `sudashuiapi` 误猜成「苏妲水API」，实为 **SdAS API**）。各站正确名见第十一节 |
| 安全 | 协议文件里**绝不写真实令牌/用户数据**，用 `credentialRef` 引用，令牌由用户在界面填 |

## 四、UI 参数面板：`uiSchemas` / `limits` / 逐格渲染

### 4.1 `uiSchemas` 的值必须是「字段数组」

```json
"uiSchemas": {
  "my-params": [
    { "key": "duration", "label": "时长", "type": "number", "default": 5, "min": 1, "max": 30, "step": 1 }
  ]
}
```
Profile 用 `"uiSchemas": ["my-params"]` 按 id 引用。字段键是 **`key`**（不是 `param`），选项是 **`options: [{label, value}]`**。
合法 `type`：`select | number | slider | toggle | text | textarea | json`。

⚠️ 写成 `{ "duration": {...} }` 这种「字段名字典」→ 不是数组 → `resolveParameterSchema` 返回 null →
**参数面板一格都不显示**（但覆盖率仍全绿）。源码另有一个未见于文档的字段：`showWhen: { models: ["xxx"] }` 可按模型控制某格显隐。

### 4.2 界面上每一格是「单独判存在性」，少一个字段就少一格

画布视频节点的工具条按固定顺序渲染：`[模式按钮] [生成音频] [时长] [画面比例] [分辨率] [更多参数]`，
它逐个用「参数 schema 里有没有这个 key」决定这一格画不画，**找不到就整格不渲染**。
所以面板需要这几格时，`uiSchemas` 里必须同时有：**`duration`、`aspect_ratio`、`resolution`、`generate_audio`**。
画布的视频白名单是 `prompt / duration / aspect_ratio / size / resolution / generate_audio`；不在名单里的（`seed`、`watermark`、`skip_review`）会落进「更多参数」弹层。

⚠️ **这种「少一格」不会让任何校验报错**：结构校验通过、覆盖率 100%、执行模拟全过，界面上照样缺。
每次改 `uiSchemas` 都要按 `references/onboarding-playbook.md` 的第 4 层逐格核对 —— **现在有脚本了：`bin/probe-panel.mjs`（第七节 ⑦）**，
它会自动取 `data/providers.json` 里绑定到该协议的**真实模型名**逐格打印。比人工核对更早发现问题，
尤其是「`match` 没覆盖站点模型名 → 一格都没有」这种根本没机会人工核对的场景。

### 4.3 `limits` 的结构

```json
"limits": {
  "references": { "images": { "max": 9 }, "videos": { "max": 3 }, "audios": { "max": 3 } },
  "resolution": { "options": ["720P"], "default": "720P", "readonly": true },
  "features": { "generate_audio": false }
}
```

- **`references` 必须嵌套**（`modelDescriptor.ts:60,73` 读的是 `object(limits.references)[kind]`）。写成平铺的 `limits.images` 不被任何代码读到 → 张数上限形同虚设。
- 档位写 `{ "options": [...], "default": ... }`；`{ "fixed": 15 }` / `{ "enum": [...] }` 是自造键，不被识别。数值档位可配 `min` / `max` / `step` / `default` / `readonly`。
- `limits.features[key] = false` 是把字段**删掉**（`protocolManifest.ts:99` `return []`），不是置灰。

### 4.4 `limits` 是 Profile 级的，不是模型级的

一条 Profile 覆盖多个取值不同的模型时，面板只能显示一个默认值（会把高配模型显示成低配值）。
→ 按「同一组取值」把 Profile 拆开，保证一条 Profile 只对应一组一致的参数；
取值被型号固定的（分辨率写在型号名里）写 `{ "options": ["720P"], "default": "720P", "readonly": true }`。

### 4.5 `modelProfiles` 形态与匹配顺序

- `modelProfiles` 用**字典形态**（`{ "profileId": {...} }`）；写成数组会导致 Profile 校验被静默跳过。`profile.workflows` 也是字典（`{ "<intent>": "<workflowId>" }`）。
- Profile 匹配是**前缀命中 + 取第一个**：模型名以某个 `match` 值**开头**即算命中。
  → **笼统档必须排在具体型号之后**，否则具体型号会被笼统档冒名接管（能力/参数/限额全错，但覆盖率依然全绿）。
- 只声明手册明确写了的能力和参数；手册没写的宁可留 `missing`，要兜底就单独建一条 Profile，方便一键删除。

## 五、素材交付模式（`assets`）：最容易写错的地方

运行时取规则时**档案级优先**（`server/ai-tasks/declarativeRouter.ts:49`）：

```ts
return profile?.assets?.[key] || protocol.assets?.[key]
```

四种模式（`declarativeRouter.ts:94-106` 逐个分支）：

| `assets.mode` | 含义 | 何时用 |
| --- | --- | --- |
| `upload_operation` | 协议自己上传，素材对象上得到上传返回的键；**必须**配套 `workflow.uploads` | 上游有上传端点时最通用：本地文件 + 公网 URL 都能接 |
| `data_url` | 内联 base64 提交（本地文件直接用，远程 URL 会自动下载再转 Base64） | **图片类默认选它**；走 `$dataUrlBase64` / multipart `$files` / `{{inputs.images[*].dataUrl}}` 的链路 |
| `public_url` | 只收公网 http(s) | 上游只要 URL，且**目标用户会开画布的「素材传输 = URL」（走图床）**。用户若走 Base64 方式，本地素材没有 url → 409（见 5.1） |
| `remote_name` | 上游只认文件名 | 少见（同样接不住本地素材，见 5.1） |

### 5.1 头号坑：Canvas 默认的本地素材**只有 dataUrl**

画布上传/生成的素材，运行时经 `ai-tasks/canvasAssets.ts:58-68` 解析出来只有：

```ts
{ assetId, kind, dataUrl, mime, name, bytes }   // 没有 url，没有 remoteName
```

`url` / `remoteName` 只有在**用户把输入卡片的素材来源切成「公网 URL」**时才会出现
（canvas 1.0.112 的 `Z3()`：卡片媒体 mode 必须是 `url` 且 `/canvas/public-media` 上传成功，
状态 `valid`/`expiring`）。默认状态下**没有**。

于是 `declarativeRouter.ts:94-105` 的 `public_url` / `remote_name` 分支必然返回 `null`
→ `standardProtocolTaskFromAiTask()` 返回 `null`
→ 路由回落 legacy（`unsupported_local_input`）
→ `index.ts:3773` 直接 **409**：

```
canvas Surface 只允许已精确启用的声明式协议，当前不可执行：unsupported_local_input
如果该平台尚未完成新协议迁移，可尝试打开画布右上角的「兼容模式」后重新生成。
```

**这条错误信息里的「兼容模式」是误导**：切到 legacy 只会把同一份协议交给更老的执行器，
本地素材照样送不出去。真正的修法是让素材规则能接住 dataUrl。

结论（图片素材）：**`assets.images.mode` 写 `data_url`，body 里读 `{{inputs.images[*].dataUrl}}`**。
体积大的视频/音频若坚持 `public_url`，必须接受「用户得先把输入卡片切成公网 URL 才能用」这个前提，
并且要在交付说明里写清楚。

实测（2026-09-11，api.qnaigc.com）：`POST /queue/openai/gpt-image-2/edit` 的
`image_urls` **直接接受 `data:image/png;base64,...`**（返回 200 IN_QUEUE，最终 COMPLETED），
所以 fal 队列系列"只要 URL"其实也吃 Data URL，别想当然地给它配 `public_url`。

| 协议里用到的写法 | 必须的模式 | 写错的报错 |
| --- | --- | --- |
| `$dataUrlBase64`（Gemini `inlineData.data`） | `data_url` | `$dataUrlBase64 必须渲染为 Data URL 字符串` |
| multipart 里的 `$files` | `data_url` | `multipart 文件必须来自已解析的 Data URL 素材` |
| `{{inputs.images[*].url}}` / `{{item.url}}` | `public_url` | 渲染成 undefined |
| `{{item.name}}` | `remote_name` | 渲染成 undefined |

**同一模型协议里既有走 url 的视频链路、又有走 Base64 的图片链路** → 顶层按视频链路写 `public_url`，图片档案覆盖成 `data_url`：

```json
"modelProfiles": {
  "xxx-image-gemini": {
    "match": ["gemini-3-pro-image-preview"],
    "capabilities": ["image.generate", "image.edit"],
    "assets": { "images": { "mode": "data_url" } }
  }
}
```

⚠️ 两个反直觉点：
1. `declarativeRouter.ts:93` —— **档案一旦声明了 `assets`，没覆盖到的素材类型会被静默丢弃**（`if (profile?.assets && !rule) return null`）。档案级 `assets` 要把该档案会收到的类型写全。
2. 图片档案**必须** `data_url`（否则本地图片直接 409，见 5.1）；视频档案若写 `public_url`，交付时要明确告诉用户「参考视频/参考音频得把输入卡片切成公网 URL」。只写协议级 `public_url` 会保住视频、悄悄写坏所有图片链路。

### 5.2 图片语义：参考图 vs 首帧（「结果没遵循参考图」的根因）

同一组 `images`，写成裸 URL 还是带 `type`，上游行为可能完全不同。**动手前先看上游文档里「图生视频」那一节的示例**：

| 上游写法 | 语义 | 约束强度 |
| --- | --- | --- |
| `"images": ["https://…/a.png"]` | 参考图 | 弱 —— 模型只"参考"，不保证构图/人物一致 |
| `"images": [{ "url": "…", "type": "first_frame" }]` | **图生视频首帧** | 强 —— 视频从这张图起帧 |
| 再加 `{ "type": "end_frame" }` | 首尾帧 | 强 |

**佳速实测（2026-09-13）**：`创建视频(推荐).md` 明写「不传 `type`：作为参考图；`type=first_frame`：图生视频首帧」，且**官方 i2v 示例用的就是 `type: first_frame`**。原协议下发 `{{inputs.images[*].url}}`（裸 URL）→ 所有 i2v 被上游当"参考图"处理 → 用户反馈「生成的视频没有遵循参考图」。

**为什么不能直接透传 `role`**：DX OS 确实会在素材上带 `role`（`StandardProtocolAsset.role`，`declarativeRouter.ts:155-171` 逐条保留），模板里 `{{item.role}}` 可用。但 DX OS 的取值是 `reference_image` / `first_frame` / `last_frame`（`index.ts:3248-3252`）：

- **单图 i2v 永远只给 `reference_image`，从不给 `first_frame`**；
- 只有「mode=i2v ＋ ≥2 图 ＋ 画布开关选『首尾帧』」时才给 `first_frame`/`last_frame`，此时 intent 变成 `video.first_last_frame`。

而多数上游的 `type` 枚举**不含 `reference_image`**（佳速只有 `first_frame|end_frame|last_frame`，不传即参考图）。模板层又**没有 lookup**（只有 `$coalesce / $keyValue / $map / $cardinality / $merge`），没法把 `reference_image` 映射成"省略该字段"。**所以唯一正确解法是按 intent 拆 operation**：

```text
video.image_to_video    → submit.video.first_frame     # 单图：显式 first_frame
video.first_last_frame  → submit.video.first_last      # 首尾帧：透传 role
video.multi_reference   → submit.video                 # 多参考：裸 URL，不带 type
video.text_to_video / video_to_video / audio_reference → submit.video
```

```jsonc
// submit.video.first_frame（单图 → 强制首帧）
"images": { "$map": { "from": "{{inputs.images}}", "template": { "url": "{{item.url}}", "type": "first_frame" } } }

// submit.video.first_last（首尾帧 → 透传 DX OS 给的 role；role 缺失时该字段整个消失）
"images": { "$map": { "from": "{{inputs.images}}", "template": { "url": "{{item.url}}", "type": "{{item.role}}" } } }

// submit.video（保留裸 URL，语义 = 参考图）
"images": "{{inputs.images[*].url}}"
```

⚠️ 三个配套点：

1. 想让画布的「首尾帧」开关可用，`video.first_last_frame` 必须**同时**出现在四处：协议级 `capabilities`、档案 `capabilities`、协议级 `workflows`、档案 `workflows`。缺任一处会报「模型协议没有匹配 video.first_last_frame 的 workflow」。
2. 画布的「智能多参 / 首尾帧」开关（`video_reference_mode`）会被 `index.ts:3127` 从转发参数里**删掉**，协议看不到它 —— 别指望用它做判断。
3. **别一刀切**：上游文档示例若本来就是裸 URL（如 aicost `seedance.md` §4.2「图片参考生成视频」的示例即 `"images": ["…/reference-1.jpg"]`，首尾帧走 MiniMax H3 专属的 `start_frame`/`end_frame`），就**不要**加 `type`。判断依据只有上游文档，不是"别的站加了我也加"。

#### 5.2.1 ⚠️ 「结果没遵循参考图」不等于 type 写错 —— 先分清两种归因

`type` 语义只是**其中一条**成因，**别一看到这四个字就改 `type`**。先做「同一症状 → 成因」判别：

| 症状 | 先查什么 | 结论 |
| --- | --- | --- |
| **单图** i2v，结果只是"参考得不像" | 上游文档的 i2v 示例用的是裸 URL 还是 `type:first_frame` | 用了裸 URL → 真的是 type 问题（见上表） |
| **多图**（≥2 图，多参考）结果完全不像参考图 | ① 实际 body 的 `images` 数组顺序 ② prompt 里 `@图片N` 与实际图片的对应 ③ **prompt 正文的场景/服装/风格描写是否与参考图一致** | 顺序与引用对齐后，**绝大多数是 prompt 与参考图内容冲突**（见下） |
| 任何情况 | 参考图 URL 是否公网可达（`curl -I`） | 源码/二进制能取到 ≠ 上游取到；实测 URL 200 才排除"图没送到" |

**真实案例（2026-09-13，佳速 2 图多参考，`gen-1789313483923`）**：用户报"传了 2 张图多参考也没遵循参考图"。逐层取证后——

- body 里 `images` 是**两个裸 URL**（多参考本就该裸 URL，**类型语义正确**）；
- 上游按数组顺序自动命名，`图片1` = 黑袍男主、`图片2` = 粉裙女；
- prompt 里 `姜离@图片2` / `顾廷辞@图片1` —— **角色与图片一一对应，没有错位**；
- 但 prompt 正文写的是**现代职场**（公司茶水间/饮水机/大理石台面/西裤口袋/玻璃幕墙/高跟鞋），参考图是**古风汉服立绘**；
- 产物 = 现代职场实拍，参考图被完全忽略。

→ **根因是「文本与参考图内容冲突」，协议一个字都不用改。** 处置建议是用法侧：让 prompt 与参考图同源、多图一致性改用 `seedance-2.5` 系「全能多参」、把 14 秒 3 分镜拆成一镜一次生成。

**判据**：先把「实际 body 的 images 数组 + prompt 引用标记 + 引用指向」三者对齐核一遍（用 `_compile_body.mjs` 这类小脚本把真实输入喂进 `compileProtocolPlan`，比读库更快），确认协议侧无误后，**再**去核对 prompt 正文与参考图的内容一致性。跳过第一步就改协议 = 白改。

#### 5.2.2 首帧/尾帧时**不能**同时下发 `audios`

上游文档普遍明示（佳速 `佳速api开发文档.md`：「使用 first_frame / end_frame 时不要同时传 audios」）。

所以 **`submit.video.first_frame` / `submit.video.first_last` 的 `bodyTemplate` 里不要写 `audios` 字段**，把 `audios` 只留给 `submit.video`（`multi_reference` / `video_to_video` / `audio_reference` 用）。

一行之差，但 `omitEmpty: true` **不会**帮你兜住——只要用户挂了音频，`audios` 就会被下发。校验方法（直接跑内置样例，四 intent 一次覆盖）：

```bash
MSYS_NO_PATHCONV=1 "$N" --experimental-transform-types "$S/inspect-request-body.mjs" \
  "<provider.json>" "<model.json>" "<技能目录>/references/request-fixture.example.json"
# 期望输出：
#   video.image_to_video    → images=[{url,type=first_frame}]   audios: （未下发）
#   video.first_last_frame  → images=[{url,type=first_frame},…] audios: （未下发）
#   video.multi_reference   → images=[裸URL,…]                  audios: ["…"]
#   video.audio_reference   → images=[裸URL]                    audios: ["…"]
```

真实案例（2026-09-13 佳速）：v2 的 `submit.video.first_frame` / `.first_last` 仍带 `audios`，
按文档改成 v3 后，实测 `image_to_video` 的 body 变成
`{"…","images":[{"url":"…","type":"first_frame"}],"videos":[…]}`
（`audios` 消失），而 `multi_reference` 仍保留 `"audios":[…]`。

## 六、根因级坑：Canvas 面板「分辨率/比例/时长」会串台

「API 生成」面板由内置 Canvas 应用渲染（不是主进程 bundle），它的 `resolution` 等参数状态**在图片页和视频页之间共享**：

- 图片页分辨率：`1k / 2k / 4k`；视频页分辨率：`"" / 480p / 720p / 1080p`
- 视频页比例：`16:9 9:16 1:1 4:3 3:4 21:9 9:21 keep_ratio adaptive`；时长：`3 4 5 6 8 10 12 15 20 25 30`

在图片页选过 `1k` 再切到视频页，请求里就会带 `"resolution": "1k"` → 上游只支持 `480p/720p` 的视频模型直接 400 `invalid_resolution`。
**协议侧兜底写法**（不要指望 UI 只发合法值）：

```json
"bodyTemplate": { "resolution": "{{derived.resolution}}", "ratio": "{{derived.ratio}}", "duration": "{{derived.duration}}" },
"derive": {
  "duration": { "op": "clamp",
    "value": { "op": "coalesce", "values": [{ "ref": "params.duration" }, { "literal": 5 }] },
    "min": 4, "max": 15 },
  "ratio": { "op": "lookup",
    "value": { "op": "coalesce", "values": [{ "ref": "params.aspect_ratio" }, { "ref": "params.ratio" }] },
    "cases": { "16:9": "16:9", "9:16": "9:16", "1:1": "1:1" },
    "fallback": "16:9" },
  "resolution": { "op": "lookup", "value": { "ref": "params.resolution" },
    "cases": { "720p": "720p", "1080p": "1080p" }, "fallback": "720p" }
}
```

注意：`clamp` 内部的 `finiteNumber()` **遇到非数字会抛错**，所以必须先 `coalesce` 给字面量兜底，不能裸 clamp `params.duration`。

### 必须用「白名单 + fallback」，不要枚举非法值

`lookup` 的 `fallback` 接住**所有**未列出的取值（含 `2:3`/`3:2`/`source` 这类图片页比例、以及 UI 以后新增的选项）。
所以 `cases` 只列**上游允许的值**，其余一律交给 `fallback` —— 不用穷举脏值，未来也不会漏。

### 陷阱：多个档案共用同一个 operation 时，兜底会互相打架

`derive` 挂在 **operation** 上，`modelProfiles[].workflows` 只把 intent 映射到 workflow、workflow 再指向 operation。
所以**两个档案的合法集合互斥时（一方合法值恰好是另一方的非法值），一个 operation 不可能同时兜对**，必须拆。

真实案例（aicost）：`seedance2.0` 吃 `480p/720p/1080p`，`seedance2.5` 吃 `720p/1080p/1k/2k` —— `480p` 是 2.5 的非法值、`1k/2k` 是 2.0 的非法值。
处理：拆成 `submit.video.seedance25` / `submit.video.seedance20` 两个 operation，把通用 workflow 按后缀各复制一份（`video.text_to_video.seedance25` / `.seedance20`），最后把两个档案的 `workflows` 分别指过去。`.h3` 这类后缀命名已验证可行。

判据：把各档案的合法集合摆出来，**只要存在「A 合法而 B 非法」的值，就拆**。

### 图片尺寸：「原图比例」不是字面量，分辨率是小写（静默改图重灾区）

Canvas「系统参数」的比例下拉是 `1:1 2:3 3:2 3:4 4:3 9:16 16:9 21:9 9:21 source`（`source` 显示为「原图比例」）。
选它时客户端**不会**把 `source` 发给协议，而是先按输入图真实宽高做 GCD 约分，把结果填进 `params.aspect_ratio`：

```js
// Canvas 1.0.112 内置 bundle 反查所得
Xd(t) => t.params.ratio === "source" ? qy(t) : t.params.ratio || "1:1"
qy(t) => GCD 约分后 `${w/g}:${h/g}`   // 实测发出 "1055:1491"
hr(t) => "1k" | "2k" | "4k"           // 小写，不是 uiSchemas 里声明的大写 "2K"
```

后果（**全程不报错，只有对着成图量像素才发现**）：

- `lookup(cases={10 个枚举}, fallback=1)` → 比例落到 fallback → 长宽相等 → 用户要原图比例，拿到正方形；
- `lookup(cases={"1K":1024,"2K":2048})` → 小写不命中 → 落到兜底 literal → 2K 请求实际出别的尺寸。

顺带：`params.size`（`"1024x1024"`）也是画布按它内置表算的，`source` 时同样回落到 `1:1` 的表值，**不能当权威值用**。

**非标准比有三种归宿，用哪一种必须实测判定 —— 不要猜上游类型：**

| 归宿 | 适用上游 | 实测证据（2026-09-11，参考图 300×700 = 3:7 ≈ 0.4286） |
| --- | --- | --- |
| `size:"auto"` | 上游自己看图定尺寸（像素型） | aicost `gpt-image-2` edit → **822×1913（0.4297）精确跟随** ✅ 最优 |
| **原样透传**具体比 | Gemini 系 relay（会就近映射） | change2pro → 768×1376（0.5581 = 9:16），**就近映射到最近标准比** ✅ 最优可得 |
| 白名单归一 → `auto` | 明确支持 `auto` 的枚举型上游 | 七牛 fal gemini → `auto` 生效（实测） |

**反面教材（实测证明没用，别抄）：**
- 枚举型上游**省略** `aspectRatio` → change2pro 实测 **1024×1024（1:1）**，等于没选；
- 给枚举型上游 **`aspectRatio:"auto"`** → change2pro 实测同样 **1:1**（`auto` 不是它的合法值，被静默忽略）。

**判据是真跑一次量像素，不是静态推断**：生成一张 `300×700`（3:7）的参考图，把 `auto` / 透传具体比 / 省略三条路各发一次，看谁最接近 `0.4286`。
第七节 ⑥ 的探针只能**静态**提示，最终仍需这轮线上验证（七牛、aicost、change2pro 都是这么定下来的）。

**两种 body 形态的具体写法：**

1. 上游吃**像素尺寸**（`size: "WxH"` 字符串，如 aicost gpt-image-2）—— 标准比查表出像素，**非标准比给 `auto`**。
   `lookup` 的 `fallback` 给空字符串 → `$keyValue` 的 key 为空 → 返回 `UNDEFINED` → `$coalesce` 切到下一分支。**「空 key 当开关」是模板层唯一的条件分支手段**（`$coalesce` 取第一个渲染后非空的结果，`$keyValue` 在 key 为空时返回 UNDEFINED）：

```json
"bodyTemplate": {
  "$merge": [
    { "$coalesce": [
      { "$keyValue": { "key": "{{derived.sizeKey}}", "value": "{{derived.width}}x{{derived.height}}" } },
      { "$keyValue": { "key": "size", "value": "auto" } }
    ] },
    { "prompt": "{{prompt}}", "quality": "auto", "output_format": "{{params.output_format}}" }
  ]
},
"derive": {
  "sizeKey": { "op": "lookup", "value": { "ref": "params.aspect_ratio" },
    "cases": { "1:1": "size", "16:9": "size", "9:16": "size" }, "fallback": "" }
}
```
   `sizeKey` 的 `cases` 只列**自己有像素算式的比例**，漏写的走 `auto`，比瞎算一个尺寸安全。
   若上游吃 `{width,height}` **对象**（fal 的 gpt-image-2），把 `value` 换成对象即可；`aw/ah` 的 `fallback` 别给 0 —— 下游有 `divide(aw/mx)`，0 会触发「不能除以 0」。

2. 上游吃**枚举**（gemini 系：`imageConfig.aspectRatio` + `imageSize`）—— **比例原样透传**（把就近映射留给上游），**分辨率必须 `upper` 归一 + 白名单**：

```json
"bodyTemplate": { "generationConfig": { "imageConfig": {
  "imageSize": "{{derived.res}}",
  "aspectRatio": "{{params.aspect_ratio}}"
} } },
"derive": {
  "res": { "op": "lookup", "value": { "op": "upper", "value": { "ref": "params.resolution" } },
    "cases": { "1K": "1K", "2K": "2K", "4K": "4K" }, "fallback": "2K" }
}
```
   分辨率是最容易漏的一环：画布发小写 `2k`、上游枚举是大写 `2K`，直接透传 = 用户选 2K 拿到别的档（**change2pro 原来就是这样**）。
   注意 `ref` 要指向该协议**真正读的那个键**：aicost 用 `params.image_size`（画布给大写），change2pro 用 `params.resolution`（画布给小写）。

**验收**：`probe-ratio.mjs`（第七节 ⑥）。它专抓「参数没生效但也不报错」，必做对照测试：改前的备份跑必须 FAIL，改后必须全绿。

## 七、真机校验（每改必跑）

```bash
# 引擎目录由 bin/dxos-paths.mjs 自动探测：扫各盘 DXOS-Portable-*-win-x64 → 取版本最高者
# → 读 .dx-runtime/.active-runtime 定位真正在跑的运行时。升级 DX OS 后无需改脚本。
# 手动指定：DXOS_ROOT / DXOS_SERVER / DXOS_ENGINE / DXOS_DATA
# 用 Windows 路径，Git Bash 下加 MSYS_NO_PATHCONV=1

# ① 先载入环境（自动解析当前机器的用户名 / 技能目录 / Node / DXOS 位置，
#    并从脚本自身位置推出仓库根，仓库放哪都行）
#    路径写 dxos-skills 实际所在位置，例如：
#      . "/d/dxos-skills/scripts/dx-env.sh"
#      . "/e/work/my-dxos/dxos-skills/scripts/dx-env.sh"
#      . "/c/Users/me/Desktop/某个目录/dxos-skills/scripts/dx-env.sh"
. "<dxos-skills 所在目录>/scripts/dx-env.sh"
# 载入后可用：$DX_REPO $DX_NODE $DX_BIN $DX_SKILL $DX_HOME $DX_USER $DX_PROJECT $DXOS_ROOT
# 想临时指定：DX_NODE=<路径> DX_SKILLS=<目录> . scripts/dx-env.sh

# ② 或用 Node 模块直接查看当前机器解析结果
node "$DX_BIN/dxos-paths.mjs"

# ① schema + 编译（不传 --intent 则遍历全部 capabilities）
MSYS_NO_PATHCONV=1 "$DX_NODE" --experimental-transform-types "$DX_BIN/verify-protocol.mjs" \
  "<provider.json>" "<model.json>" [--intent video.image_to_video] [--model-id <上游模型名>]

# ② 取值白名单断言（带兜底的协议必跑）
MSYS_NO_PATHCONV=1 "$DX_NODE" --experimental-transform-types "$DX_BIN/assert-param-guards.mjs" \
  "$DX_SKILL/references/param-guards.example.json"

# ③ hash 核对（写仓库前必跑）
MSYS_NO_PATHCONV=1 "$DX_NODE" "$DX_BIN/protocol-hash.mjs" "<protocol.json>" ...
MSYS_NO_PATHCONV=1 "$DX_NODE" "$DX_BIN/protocol-hash.mjs" --verify-store "<data/custom-protocols-v2.json>"

# ④ 语义体检（静态分析；查前三关都拦不住的「能编译但功能坏掉」）
#    不传目录时自动定位项目根（含 dxos-skills 或站点目录的层级）
MSYS_NO_PATHCONV=1 "$DX_NODE" "$DX_BIN/audit-semantics.mjs"
#    也可显式指定：… "$DX_BIN/audit-semantics.mjs" "<协议根目录>"

# ⑤ 本地素材路由探针（有图生图/图生视频/参考素材的协议必跑）
MSYS_NO_PATHCONV=1 "$DX_NODE" --experimental-transform-types "$DX_BIN/probe-local-input.mjs" \
  "<model.json>" "<provider.json>"

# ⑥ 尺寸取值矩阵回归（图片类档案必跑；专抓「参数没生效但也不报错」）
MSYS_NO_PATHCONV=1 "$DX_NODE" --experimental-transform-types "$DX_BIN/probe-ratio.mjs" \
  "<model.json>" "<provider.json>"

# ⑦ 参数面板逐格核对（改了 modelProfiles.match / uiSchemas 必跑；专抓「界面上少格子」）
MSYS_NO_PATHCONV=1 "$DX_NODE" --experimental-transform-types "$DX_BIN/probe-panel.mjs" \
  "<model.json>" "<provider.json>" [--models a,b,c]
```
③ 单文件模式打印 `<hash>  <kind>/<id>  <路径>`；`--verify-store` 模式逐条核对仓库里每个版本的 hash，并检查 `activeVersion` 是否存在，**有对不上的版本时 exit 1**（那些版本会被 DX OS 静默丢弃）。

> ⚠️ 仓库体检**必须带 `--verify-store`**，直接把目录或站点 JSON 传进去只会报
> `[读取失败] … EISDIR: illegal operation on a directory, read`。正确用法（仓库路径由 `dxos-paths.mjs` 的 `resolveDataDir()` 给出）：
> ```bash
> MSYS_NO_PATHCONV=1 "$DX_NODE" "$DX_BIN/protocol-hash.mjs" --verify-store "$DXOS_ROOT/data/custom-protocols-v2.json"
> # 期望：体检完成：8 个版本，0 个 hash 对不上（会被静默丢弃）
> ```

`verify-protocol.mjs` 按顺序做三件事：

1. **schema 校验**（`validateProtocolV2`，即 DX OS 安装协议的第一关），失败立刻终止并逐条打印 —— 这一步以前是缺的，会漏掉「装不进去」类错误。
2. **按 intent 挑真正声明了该 workflow 的档案**，避免拿图片档案去编译视频 workflow（compiler 会静默回退到通用顶层 workflow，产生假阳性）。
3. **按该档案的有效 `assets` 规则生成探针素材**：`data_url` 给 `dataUrl`、`public_url` 给 `url`、`remote_name` 给 `name`。否则 `$dataUrlBase64` / `$files` 必然误报。

**怎么判读输出**：第一关逐份打印 `[通过]` / `[失败] <问题清单>`；之后每个 intent 一段，每组参数一行 `ok | ...` 或 `ERR | ... -> 原因`；最后一行是 `=== 共 N 组，编译失败 M 组 ===`，**有失败时进程 exit 1**（可直接接进脚本判断）。

**路径写法**：传文件参数时用 Windows 风格（`C:/Users/...`）。Git Bash 下若写成 `/c/Users/...`，在 `MSYS_NO_PATHCONV=1` 时会被 node 当成 `c:\c\Users\...` 而报 ENOENT。

`--experimental-transform-types` 是必需的（validator.ts 用了 TS parameter property，strip-only 模式报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）。

**编译通过 ≠ 取值合法**，所以还要跑 ②：它把 `视频分辨率 × 图片分辨率 × 视频比例 × 图片比例` 全交叉加全部时长档位喂进真机编译，递归扫描编译后 body（含 `metadata.payload` 这类 JSON 字符串）里的 `resolution` / `ratio` / `aspect_ratio` / `duration`，断言每个取值都在配置声明的白名单内。合法集合**必须来自各站接入文档**。
改协议前先用 `baseDir` 指向一份旧版备份跑一遍，**确认断言器能报出越界**（对照测试）——否则你无法区分「协议真的干净」和「断言器写错了」。

④ `audit-semantics.mjs` 是**静态体检**，专查前三关都抓不到的一类问题：**能装、能编译，功能却是坏的（静默失败）**。规则与 `validator.ts` 逐条对齐（ID/SELECTOR/模板正则、原语字段集、`pathValue` 的占位符解析），覆盖：

| 检查项 | 不查会怎样 |
| --- | --- |
| 档案级 `uiSchemas` 必须是 `string[]` | 写成字典 → 参数面板一格不显示，覆盖率仍全绿 |
| `response` 键 ∈ 引擎白名单（14 个） | 写错键名（如 `resultURL`）→ 静默丢弃 |
| selector 正则（`[]` 不被 0.3.3 解析） | `$.a[].b` → 该字段永远取不到 |
| 模板表达式正则 + 根变量白名单 | `{{inputs.images.*.url}}` → 非法模板 |
| `$cardinality` 必含 `from/zero/one/many` | 缺 `one` → 装不进去 |
| workflow 引用完整性 | `submit` 指向不存在的 operation → 提交即失败 |
| capability 是否有人实现 | 顶层声明了却无 workflow / 档案映射 → 选了就失败 |
| path 占位符来源 | 既非模板根变量也非 capture 键 → 原样发出 `<capture:x>` |
| 素材模式 vs 操作原语 | 用 `$dataUrlBase64`/`$files`/multipart 却声明 `public_url` → 报错 |
| 素材模式 vs Canvas 本地素材 | `public_url`/`remote_name` 只认带公网 url 的素材；用户走 Base64 方式时本地素材只有 dataUrl → 409（见 5.1） |
| `upload_operation` 是否有配套 `workflow.uploads` | 缺上传步骤 → 本地素材永远传不上去 |
| `limits.references` 嵌套结构 | 平铺写法谁也读不到 |
| 档案 `match` 是否重叠 / 孤儿 operation | 解析歧义、残留死配置 |
| **提示级**：bodyTemplate 原样透传 `{{params.aspect_ratio}}`（枚举型上游） | 非标准比交给上游**就近映射**（实测 change2pro 3:7 → 9:16 = 0.5581），是可接受的最优解，不算错；换到严格校验枚举的上游才需重新实测 |
| **报错级**：bodyTemplate 直传 `{{params.resolution}}` / `{{params.image_size}}` 且**不带 `upper` 归一** | 画布发小写 `2k`、上游枚举是大写 `2K` → 静默失效（change2pro 原来就是这样，选 2K 拿到别的档） |

退出码 0/1。用法：`node audit-semantics.mjs [协议根目录]`（默认协议工作目录，也可用 `PROTO_BASE` 环境变量）。**必须做对照测试**：往副本里注入几类缺陷（空方括号 selector、缺 `one`、档案级 `uiSchemas` 写字典、断链 workflow），确认全被抓到再信它的「通过」。

⑤ `probe-local-input.mjs` 是**路由级探针**：直接 import 运行时的 `ai-tasks/declarativeRouter.ts`，
用 **Canvas 默认本地素材的真实形态**（只有 `dataUrl`/`mime`/`name`/`bytes`）跑一遍
`standardProtocolTaskFromAiTask()` —— 这正是 `unsupported_local_input` 的判定点，
比静态体检更硬：它走的是官方代码，不是我们的复刻。每个档案 × `image.generate`/`image.edit`
各跑一次，通过后再把 body 编译出来，检查图生图链路确实带上了 `data:` 开头的素材。
输出举例：`[FAIL] xxx / image.edit → 本地素材过不了素材规则 → 409 unsupported_local_input`。
改素材规则前后各跑一次，**拿到的就是「修好了」的直接证据**。

> ⚠️ 两个实测注意点（2026-09-14）：
> 1. **只对图片协议有输出**。脚本内层只遍历 `image.generate` / `image.edit`，纯视频协议（如佳速，capabilities 全是 `video.*`）会被 `continue` 跳过，输出 `>>> 0 条链路全部接受 Canvas 本地素材` —— 这是**正常的空结果，不是脚本坏了**。要验视频协议请用 ⑧ `inspect-request-body.mjs`。
> 2. **参数序是 `<model.json> <provider.json>`**（先模型后平台），传反了不会报错但跑不到东西。

⑥ `probe-ratio.mjs` 是**尺寸取值矩阵探针**（图片档案）。它把画布真实会发出去的
`比例 × 分辨率` 组合（含 `source`、`1055:1491` 这类非枚举比、小写 `1k/2k`）逐组编译，
**兼容三种 body 形态**（`size:"WxH"` 字符串 / `image_size:{width,height}` 对象 / 嵌套 `generationConfig.imageConfig`），检查五件事：

| 检查 | 抓什么 |
| --- | --- |
| A 回落检测 | 非标准比的输出与 `1:1` **完全相同** → 被静默回落（用户选原图比例拿到正方形） |
| B 分辨率生效 | 同一比例下 `1k` 与 `2k` 输出相同 → 分辨率没传进去 |
| C 比例一致 | 输出 `"WxH"` / `{width,height}` 的宽高比与注入比例偏差 > 3%（仅对声明枚举比检查） |
| D 枚举合法 | 回给上游的**分辨率**字段落在声明枚举之外（大小写敏感）→ 明确 bug |
| E 非标比处置（**提示级**） | 非标准比被**原样透传** → 记提示：Gemini 系 relay 会就近映射（实测 3:7→9:16），这是最优可得；只有被协议改成"既非声明值、又非原样"的怪值才 FAIL |

它抓的是「**能出图、不报错、但用户选的东西没生效**」——这类问题前三关和 ④ 都拦不住。
同一站点的 A/B 两类问题往往同时存在（七牛 2026-09-11：gpt-image-2 既回落又分辨率失效）。
必做对照测试：**改前备份必须 FAIL，改后必须全绿**，否则说明探针没真正覆盖到。
⚠️ 探针只能做**静态推断**：E 项提示的「上游会不会就近映射」必须再用一张 `300×700` 参考图线上实测一次才能定案（第六章）。

> ⚠️ 同样**只对图片档案有输出**（纯视频协议会输出 `>>> 共 0 组，尺寸取值全部随用户选择正确变化`，属正常空结果）。
> 参数序同为 `<model.json> <provider.json>`。
> 2026-09-14 实测七牛：36 组全部通过，`source` 与 `1055:1491` 均正确归一为 `auto`。

⑦ `probe-panel.mjs` 是**参数面板逐格探针**（第四节 4.2 的第 4 层检查，以前只有人工核对）。它直接调用运行时自己的
`resolveProtocolModelProfile()` / `resolveParameterSchema()`，**候选模型名默认从已安装的 `data/providers.json` 里读**
（绑定到该模型协议的站点模型），所以核对的就是用户在画布上真正会选到的那份清单 —— 不需要先把协议装进 DX OS。

它按 Canvas 工具条的真实判定规则（逐格判 key 是否存在）打印 `duration=有 aspect_ratio=有 resolution=有 generate_audio=无` 这种矩阵，
并在**模型名匹配不到任何 `modelProfiles[].match`** 时直接 FAIL（exit 1）——这正是最容易漏的一类：
档案匹配不上 → `resolveParameterSchema()` 返回 null → 工具条一格都不显示，而 schema / 编译 / 覆盖率全绿。

真实案例（2026-09-13，佳速 jiasuapi）：站点模型是 `seedance-2.0-933` / `seedance-2.0-900` / `seedance-2.5-*`，
但档案 `match` 只写了 `seedance-2.5-101010` / `seedance-2.5` / `kling`，
于是选 `seedance-2.0-933` 时**时长/比例/分辨率全都不显示**（也不报错）。
修法：把站点里真实存在的模型名前缀补进 `match`。跑 ⑦ 前后对照即可看到 `[档案未命中]` → `[ok]`。

顺带：`generate_audio=无` 只有在**上游确实没有这个参数**时才是对的（佳速的 `/v1/video/generations` 没有该字段，
就**不要**为了补格子而瞎加 `uiSchemas` 字段——加了又不进 `bodyTemplate`，等于给用户一个假开关）。

⑧ `inspect-request-body.mjs` 是**真实请求体取证器**（回答用户「到底发了什么」的首选工具）。
与 ① 的分工：① 用内置探针矩阵**压测取值合法性**（body 截断 300 字）；⑧ 用**你的真实输入**还原「实际会发什么」，输出**完整未截断 body** + `images` 形态判定 + prompt 里所有 `@引用`。

```bash
MSYS_NO_PATHCONV=1 "$N" --experimental-transform-types "$S/inspect-request-body.mjs" \
  "<provider.json>" "<model.json>" "<fixture.json>" [--intent <cap>] [--model <上游模型名>] [--base <baseUrl>] [--only <name 子串>]
```

`fixture.json` 与 ① 的 `--tasks` 同格式（`[{intent,name,prompt,params,inputs}]`）。内置样例
`references/request-fixture.example.json` 覆盖四 intent × 带图+带音频，专验 `audios` 规则，输出形如：

```text
case  : ① 单图 i2v + 附音频 → 期望 body 里【无】audios，images 带 type=first_frame
intent: video.image_to_video    model: …    profile: jiasu-video
images 形态: → 共 1 项：[{url,type=first_frame}]
prompt: 15 字 | 引用标记 1 个: ["@图片1"]
audios: （未下发）
```

`images 形态` 会把每项压成 `{url,type=…}` / `裸URL` 这样的短标识 —— 一眼就能看出**是参考图还是首帧**、
**有没有被偷偷补上 name**。这正是「结果没遵循参考图」类投诉最快的一步取证（配合 §5.2.1 判表）。

⚠️ 真实任务的 fixture 里常含**会过期的临时素材 URL**（如 `api.dx-os.com` 的 24h 链接），属一次性取证材料，
**用完即弃**，不要长期留存或提交进协议目录；要复用就只留「输入结构」，URL 换成 `example.com` 占位。

## 八、写入与生效

1. **必须先退出 DX OS**（Electron 主进程不吃优雅关闭）：
   `MSYS_NO_PATHCONV=1 taskkill /F /IM "DX OS.exe"`
   （Git Bash 下不加 `MSYS_NO_PATHCONV` 会把 `/IM` 当路径；不加 `/F` 对 Electron 主进程无效。）
2. 备份 → 往 `data/custom-protocols-v2.json` 写新协议（`provider` / `model` 两个桶各自独立）。
   版本条目形如 `{ "version": N, "hash": "<sha256>", "createdAt": "...", "protocol": {...} }`，并设置 `activeVersion`。
   ⚠️ **`hash` 必须正确**：`parseEntry` 会重算比对（`repository.ts:60`），对不上就**静默丢弃整个版本**（表现为「导入成功但版本没出现」）。
   写出格式保持 `JSON.stringify(store, null, 2) + "\n"`。已存在同 hash 版本时只把它设为 active，否则版本号 = 现有最大值 + 1。
   用 `bin/protocol-hash.mjs` 先核对（该脚本的 hash 已与官方实现逐字节复现：对真实仓库体检 8/8 一致）。
   ⚠️ **算 hash 只能用 Node**：`canonical()` 的对象键排序用的是 JS `localeCompare`（`repository.ts:37`），
   与 Python `sorted()` / 其它语言的字典序**不等价**；用别的方式算出来的 hash 会被静默丢弃。
3. 配站点（改 `data/providers.json`，或在界面「API 设置」里做）：站点 `protocol` = 平台协议 id、`api_key` = 用户自己的令牌；每个模型 `protocol` 必须指向**模型协议 id**、`caps` 填能力类型。
4. **重启 DX OS** → 模型状态应 `ready`、覆盖率 100%。
   `protocol-engine/repository.ts` 的 `ensureLoaded()` **只读一次并缓存**（第 71-73 行），改完协议必须重启；
   而 `providers.json` 每次都重读，可以热改。
5. 画布上新建节点逐个模型切换，确认工具条每一格都在、值正确。
6. 真跑一条最短任务（最小参数）确认端到端可用。

## 九、排查线上失败：读任务库

DX OS 把每次协议任务的**真实请求体 + 编译后的执行计划**存进 SQLite：

- `data/protocol-tasks.db` → 表 `ai_protocol_tasks`，关键列 `request_json` / `plan_json` / `error_message` / `status` / `workflow_state_json` / `remote_task_id` / `poll_attempt`
- 用托管 Python：`$DX_HOME/.workbuddy/binaries/python/versions/3.13.12/python.exe`（`$DX_HOME` 由 `scripts/dx-env.sh` 自动解析，见第七节）
- `plan_json` 里的 `steps[].request.body` 就是真正发出去的 body —— 定位「UI 到底传了什么」最快的路径

⚠️ **必须把 `db` + `-wal` + `-shm` 三个文件一起复制出来再打开**。这个库是 WAL 模式且 WAL 可达 20 MB，**最新几十条任务全在 WAL 里**：
`?immutable=1`（或只复制 `.db`）会跳过 WAL，读到的是**过期快照**——症状是"数据库里查不到刚才那条报错"，很容易误判成"任务没入库"。

### 先分清：任务**根本没入库** vs 入库后失败

如果 P 库里查不到那条失败任务，先看它死在哪个阶段 —— 路由阶段的拒绝**不会**建协议任务：

| 用户看到的报错 | 真实含义 | 该动哪里 |
| --- | --- | --- |
| `xxx Surface 只允许已精确启用的声明式协议，当前不可执行：unsupported_local_input` | **素材规则接不住本地素材**（见 5.1）。`protocolAsset()` 判 null → 路由回落 legacy → 画布 409 | `assets.<kind>.mode` 改 `data_url`，body 读 `{{inputs.<kind>[*].dataUrl}}` |
| 同一句但 reason = `protocol_v2_missing` / `model_profile_missing` | 协议没装、模型没绑协议、或 `match` 写错匹配不到档案 | 检查仓库版本、站点 `models[].protocol`、档案 `match` |
| 报错里带 `<capture:xxx>` | 轮询/下载步骤的 path 占位符没对应上 `response` 捕获键 | 对齐 capture 键名 |

**「兼容模式」不是解法**：它只是把同一份协议交给更老的执行器重跑一遍。
真正该做的是让规则能接住 `dataUrl`（`probe-local-input.mjs` 能直接验证这一点）。

### 判据：这是协议问题，还是上游问题？

拿到报错先别改协议，按这两步定性：

1. **把 `plan_json` 的 body 与接入文档的请求示例逐字段对比**（字段名、嵌套层级、必填项、大小写）。
2. **看错误信封的 `type`**：中转站（new-api 系）自己的校验/鉴权层报 `new_api_error`（如 `Invalid token`）；
   带 `upstream_error` 且 5xx 的，是**上游/渠道层**的错，与协议无关。

再加一条横向对照：**同一 key、同一站点下其他模型能跑通，就说明鉴权与网络没问题**，剩下的只可能是该模型的渠道。

真实案例（aicost gemini 图片）：
- 报错 `503 {"error":{"message":"10k pool upstream unavailable","type":"upstream_error","param":"","code":503}}`
- 同站 `gpt-image-2` 链路正常；`gemini-3-pro-image-preview` 与 `gemini-3.1-flash-image-preview` **两个模型同样 503**
- 而 plan body 与文档示例**逐字一致**（`contents[].parts[].text` + `inlineData{mimeType,data}` + `generationConfig{responseModalities,imageConfig{imageSize,aspectRatio}}`），参考图也确实内联成了 9 万字符 base64
- → 结论：**aicost 侧 gemini 渠道池不可用，协议一个字都不用改**。这种错误的正确处理是等渠道恢复或换站点，不是改协议。

### 顺手核对：轮询到底跑没跑

`remote_task_id` 为空 + `poll_attempt = 0` 表示**没进过轮询**。若该链路的上游是同步返回（如 aicost `/v1/images/edits` 直接回 `data[].url` / `data[].b64_json`），
plan 里那条带未解析 capture 的 `poll` 步骤**不会被执行**，所以不会报「仍包含未解析的 capture」——但这属于**隐患**：
一旦上游改成异步返回 `task_id`，轮询就会因 capture 未解析而失败。看到这种 plan 值得提醒用户。

### 「上游成功了，DX OS 却显示失败」——先怀疑轮询被瞬时错误判死

高发的用户投诉句式：**「生成成功了 / 后台能看到成片，但 DX OS 显示失败」**。判据全在任务库里，一眼可辨：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `remote_task_id` | 非空 | **提交成功**，上游确实接了单（上游侧自然能看到任务/成片） |
| `poll_attempt` | 很大（几十~几百） | 轮询跑过很久，不是一开始就错 |
| `error_message` | `fetch failed` | **本地到上游的网络请求抛异常**，不是上游返回的错误信封 |
| `status` | `failed` | 在轮询中途被判死 |

配套再看 `ai_protocol_task_events`：大量 `progress` 事件状态停在 `queued` /
`in_progress`（progress 不涨），最后一条是 `failed{message:"fetch failed"}` —— 典型形态。

**根因（三层串起来才是完整链条）**：
1. `workflow.ts:519` `resumeProtocolPlan` 里的轮询请求**不区分错误类型**，
   `executeRequest` 抛出的任何异常都直接冒泡；而 `workflow.ts:253`
   只在 `retry.retryNetwork === true` 时重试，协议不写 `retry` 时 `totalAttempts = 1`
   → **一次瞬时网络抖动 = 轮询函数抛错**。
2. `ai-tasks/service.ts:214-221` 的 catch **一律**把任务写成终态 `failed`，
   可恢复的 `pending` 任务就此消失。
3. `ai-tasks/store.ts:157-162` 转入终态时**主动擦除** `request_json` / `plan_json` /
   `workflow_state_json`，并置 `next_poll_at = NULL` → `listDueAiProtocolTasks`
   （`store.ts:146`，条件 `status='pending' AND next_poll_at IS NOT NULL`）**永远扫不到它**。

**这跟引擎自己的设计直接矛盾**：`index.ts:8830-8869` 每 5 秒跑一次
`recoverDueProtocolTasks()` 恢复到期任务，说明"可恢复轮询"本来就是设计目标，
却因为第 2 步的错误分类被架空。

> **协议作者能做的只有"加大重试窗口"**（`attempts` 上限 10，见第六节校验规则）：
> 例如 `{attempts:7, delayMs:3000, backoff:2}` ≈ 硬扛 **189 秒**网络中断，
> 超出就照样判死。**根治必须靠引擎修复**——完整定位 + 补丁建议见工作区根目录
> `DX OS 协议引擎缺陷-修复建议.md`（含复现步骤与涉及文件清单）。
>
> ⚠️ **别给 `submit` 加 `retryNetwork`**：POST 重试可能重复建单（首个请求已落地但响应丢失），
> 属真实资损风险。只有幂等 GET（`query`）才适合重试。

⚠️ **失败任务的 `request_json` / `plan_json` 是 `{}`，这是被主动擦掉的，不是"有时为空"**
（`store.ts:157-162` 的终态压缩，见上面第 3 步）。**同一台机器上 running/pending 任务是完整的**
（实测 `request_json` 2107 B / `plan_json` 3037 B）。
所以：**排查要用还没失败的任务；已经 failed 的只能去画布库 `ccs.db` 找**——
这也是为什么"先查任务库，空串再去画布库"是硬规则。

### 怎么证明「参数/prompt 到底有没有发出去」（用户最常问）

不要在对话里靠推断回答，直接读**已落库的编译结果**——`plan_json` 就是最终要发的 plan：

```js
// 任务库复制三件套后（.db/.db-wal/.db-shm 必须一起）
const d = db.prepare("SELECT * FROM ai_protocol_tasks WHERE id=?").get(taskId)
const plan = JSON.parse(d.plan_json)          // format: dx-protocol-plan/v1
const submit = plan.steps.find(s => s.id === 'submit')
submit.request.body.prompt                    // ← 真正发出去的 prompt（逐字节比对原文即可）
submit.request.retry                          // ← 证明 retry 修好没有
plan.steps.find(s => s.id === 'poll').repeat  // ← 证明 backoff/maxDurationMs 生效没有
```

判据：`plan.protocol.model` / `plan.protocol.profile` 给出实际命中的档案；
`submit.request.body` 顶层字段就是上游收到的 JSON；**用 `===` 与画布原文比对**，
相等即"一字不差发出去了"。这份 plan 比画布库更权威（画布存的是提交前的请求，
plan 存的是**编译后**、含 `{{prompt}}` 已代入的最终形态）。

画布库仅作交叉验证：`data/ccs.db` → 表 `canvases` 的 `document_json`（结构是 `cards[]`，
**不是 `nodes[]`**），生成卡 `params.protocolParams.generationRequest` 存着提交前的
`prompt`/`params`/`publicInputs`。`ccs.db` 同样是 WAL，三个文件一起复制。

**任务已经 `failed` 时改用画布库做「保真度 diff」**（`plan_json` 已被擦，见上一节）。
同一个视频卡里同时存着两份文本，直接逐字符比即可：

```python
card = next(c for c in doc["cards"] if c.get("appId") == "canvas.generate.video")
editor = card["params"]["prompt"]                                  # 编辑器原文
sent   = card["params"]["protocolParams"]["generationRequest"]["prompt"]  # 实际提交
difflib.SequenceMatcher(None, editor, sent).get_opcodes()          # 只该有 2 处差异
```

**实测的正常差异只有两处，都属于预期归一，不是丢内容**：

1. 引用标记 `@图[N]`（画布编辑器内部 token）→ `@图片N`（接口要求的引用名）。
   恰好命中「不传 `name` 时素材自动命名为 `图片N`」的约定，所以是**对的**，
   不要在协议里再画蛇添足去解析 `@图[N]`。
2. 末尾多余空行被裁掉。

除这两处外应逐字节相同；若出现截断/转义损坏/字段丢失，才是真问题。

**任务还没跑、或想「先预演会发什么」** → 用 ⑦ 之外的 ⑧：把真实 prompt + 真实素材 URL 写成 fixture，
`inspect-request-body.mjs` 直接编译出**完整 body + images 形态 + 全部 @引用**。
比读库更快，也比在对话里推断更可靠（见第七节 ⑧）。

⚠️ **用户说「后台已失败但界面还在生成中」时，先别当卡死**：画布上那个
`生成中 30:04` 是**前端本地计时器**，要等轮询回写终态才停。判据看事件时间线里
轮询是否连续（`ai_protocol_task_events` 按 `sequence` 排序，算相邻间隔）——
实测每 15 s 一次、零断档，仍可能比上游自己看板的「完成时间」晚约 5 分钟，
那是**上游两个接口口径不一致**，会自行收敛。

⚠️ **别用版本号判断修复是否生效**：`custom-protocols-v2.json` 顶层是 `{format, provider, model}`，
条目形如 `{id, kind, activeVersion, versions}`，`versions[key].protocol` 才是协议本体。
**认 hash**：任务行的 `model_protocol_hash` 与仓库**某个版本槽**的 hash 一致即同一份协议。

⚠️ **写新版本时必须保留旧版本槽**（`repository.ts:161-166` 的 `saveProtocolV2` 只追加、不清理）：
- 正在轮询中的任务，恢复时会**按自己记录的版本号取槽再比 hash**（`service.ts:187-188`），
  旧槽被删 → 任务恢复即失败；
- 所以「保留 v1、追加 v2」是正确做法，**别把旧槽删掉换成单槽**。
- 已实测（2026-09-13，runtime 0.3.6）：`versions["1"] + versions["2"] + activeVersion=2` 能稳定共存，
  重启 DX OS 后两个槽都在。旧笔记里「0.3.5 会把仓库归一成单个 active 槽」的说法**与本次实测不符**，
  以「多槽共存 + 认 hash」为准。

## 十、各站合法取值集合（兜底必须按这份表写）

### 图片档案（2026-09-11 实测）

| 站点 / 模型 | aspect_ratio 枚举 | 分辨率字段 | 非标准比归宿（实测） |
| --- | --- | --- | --- |
| 七牛 `gpt-image-2` | 10 个（含 `21:9` `5:4` `4:5`） | `1K` `2K` `4K` | 标准比查像素表，非标准比让 `image_size` 字段消失 → 上游 `auto` |
| 七牛 gemini pro/flash | 11 个（含 `9:21`） | `1K` `2K` `4K` | 白名单归一，非枚举 → `auto`（**该上游 `auto` 实测生效**） |
| aicost `gpt-image-2` | 7 个（`1:1 16:9 9:16 4:3 3:4 3:2 2:3`） | `image_size` 大写 | **`size:"auto"` → 实测 822×1913（0.4297）精确跟随原图** |
| aicost gemini pro/flash | 7 个 | `image_size` 大写 | 原样透传（上游就近映射） |
| change2pro banana | 10 个（含 `21:9` `5:4` `4:5`） | `resolution`，**上游必须大写** | 原样透传（实测 3:7 → 768×1376 = 9:16） |

⚠️ change2pro 是**唯一一个画布传小写、上游要大写**的站点，`resolution` 不做 `upper` 归一会让 1K/2K/4K 全部失效。

### 视频档案（这些才需要 duration 兜底，且各站合法集合不同）

| 站点 / 模型 | resolution | ratio | duration |
| --- | --- | --- | --- |
| `MegabyAI` | `480p` `720p` | `16:9` `9:16` `1:1` | 4–15 |
| `aicost` / `minimax-h3`·`hailuo-03` | 只 `1440P` | `21:9` `16:9` `4:3` `1:1` `3:4` `9:16` | 5–15 |
| `aicost` / `seedance2.5` | `720p` `1080p` `1k` `2k` | `16:9` `9:16` `1:1` | 1–30 |
| `aicost` / `seedance2.0` | `480p` `720p` `1080p` | `16:9` `9:16` `1:1` | 1–30 |
| `佳速 jiasu` | `720p` `1080p` | `16:9` `9:16` `1:1` | 文档未给范围 |
| `sudashuiapi` | **不发该字段**（由模型名决定） | `1:1` `3:4` `4:3` `9:16` `16:9` `21:9` `adaptive` | 4–15 |

现状：MegabyAI / aicost（h3 + seedance2.5 + seedance2.0）/ 佳速 / sudashuiapi **均已加兜底并通过断言**。
修改前先读各站接入文档确认合法集合，改完必须跑第七节的**三步**校验。

### 各站平台中文名（写 `label` 时照这份表，别自己编）

| 目录 | 平台中文名 | `label` 写法示例 | 名称依据 |
| --- | --- | --- | --- |
| `佳速api文档` | **佳速API** | `佳速API 平台` / `佳速API 视频模型` | 域名 `ai.jiasuapi.com`，文档自称「佳速 API」 |
| `七牛` | **七牛 Modelink** | `七牛 Modelink 平台` / `七牛 Modelink 图片模型` | 文档「Modelink 图像生成 API」，域名 `api.modelink.ai` |
| `aicost` | **AICost** | `AICost 平台` / `AICost 图片模型` | 域名 `www.aicost.me`，文档「aicost.me 图片插件模型接口」 |
| `change2pro` | **Change2Pro** | `Change2Pro 平台` / `Change2Pro 图片模型` | 文档「Change2Pro 香蕉生图 API 接入文档」 |
| `MegabyAI` | **MegabyAI** | `MegabyAI 平台` / `MegabyAI 视频模型` | 域名 `newapi.megabyai.cc` |
| `sudashuiapi` | **SdAS API** | `SdAS API 平台` / `SdAS API 视频模型` | **用户确认（2026-09-14）**。⚠️ 不要从域名音译成「苏妲水」 |

> 新增站点时**先问用户或读文档核实平台名**，核实不到就保留英文原名，**不要从域名硬凑中文**。

## 附：关键源码位置（想确认什么就去读）

| 想确认什么 | 去读（`<最大 runtime>/resources/app.asar.unpacked/server/`） |
| --- | --- |
| 结构合法性规则（哪些字段会被拒） | `protocol-engine/validator.ts` |
| 模板渲染、`$map` / `$cardinality` / `joinUrl` / `dataUrlBase64` 语义 | `protocol-engine/compiler.ts` |
| 上传、延迟引用、轮询、结果解析 | `protocol-engine/workflow.ts` |
| 协议类型定义（哪些字段是必填） | `protocol-engine/types.ts` |
| 协议仓库读写、hash 校验、缓存策略 | `protocol-engine/repository.ts` |
| 参数面板、`limits` 如何作用到字段、Profile 匹配 | `protocolManifest.ts` |
| 模型描述符、意图映射 | `modelDescriptor.ts` |
| 素材交付模式分支 | `ai-tasks/declarativeRouter.ts`、`ai-tasks/assetResolvers.ts` |
| **内置协议范例（写之前一定先看）** | `protocol-engine/builtins.ts` |
| 界面工具条逐格渲染逻辑 | `data/developer-apps/.versions/canvas/<ver>/source/assets/index-*.js` |
