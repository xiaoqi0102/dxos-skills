# DX OS 协议接入技能（dxos-protocol-authoring）

> 一套给 AI 助手用的技能包：**把任意上游 API 接入 DX OS（本地桌面版）自定义协议**，并在装进 DX OS 之前就把坑跑出来。

DX OS 的模型接入靠两份声明式 JSON（`schemaVersion: "dx-protocol/v2"`）——平台协议（provider）+ 模型协议（model）。手写时最麻烦的地方在于**大量错误是静默失败**：协议"看起来对"，但面板少一格、参数没生效、版本导不进去，全都不报错。

本技能的核心方法论是：**不靠猜，直接把协议丢进 DX OS 运行时自己的 `protocol-engine` 编译一遍，看最终发给上游的 body。**

配套 7 个离线校验/取证工具，可以在**不进 DX OS、不发真实请求**的前提下把这些坑提前跑出来。

---

## 快速开始

```bash
# 0. 获取代码
git clone https://github.com/xiaoqi0102/dxos-skills.git
cd dxos-skills

# 1. 把这个技能整个复制进 DX OS 技能目录
mkdir -p ~/.workbuddy/skills
cp -r skills/dxos-protocol-authoring ~/.workbuddy/skills/

# 2. 设两个变量（路径按自己的实际位置改）
N="C:/Users/<用户名>/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
S="C:/Users/<用户名>/.workbuddy/skills/dxos-protocol-authoring/bin"

# 3. 跑第一关：schema 校验 + 真机编译压测
MSYS_NO_PATHCONV=1 "$N" --experimental-transform-types "$S/verify-protocol.mjs" \
  "<provider.json>" "<model.json>"
```

> ⚠️ 凡是会 `import` 引擎 `.ts` 的脚本**必须带 `--experimental-transform-types`**，漏了会抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。
> 只有 `protocol-hash.mjs`（③）和 `audit-semantics.mjs`（④）是纯 JS，不需要该 flag。

DX OS 运行时路径**无需手动指定**——`bin/dxos-paths.mjs` 会自动扫盘定位。装在非常规目录时才需要设 `DXOS_ROOT`。

详细用法见下方完整文档，或直接看 `SKILL.md`（可执行清单 + 硬约束速查表）。

---

## 密钥安全（协议里要填 apiKey 的，务必先看）

协议文件的 `provider` 段通常要填上游 `apiKey`。**真实密钥绝不能进版本库**——本技能所在的 `dxos-skills` 仓库装了三道防线：

| 防线 | 位置 | 作用 |
| --- | --- | --- |
| 文件名 | `.gitignore` | 挡住 `.env` / `*.key` / `*.pem` / `*apikey*.json` 等 |
| 文件内容 | `hooks/pre-commit` | 提交前扫描，拦住藏在普通文件里的密钥 |
| 手动/CI | `scripts/scan-secrets.mjs` | 随时全仓扫描 |

克隆后**先启用钩子**（`.git/hooks` 不随仓库分发）：

```bash
sh scripts/install-hooks.sh                                        # Git Bash / macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts/install-hooks.ps1 # Windows
```

手动体检：

```bash
node scripts/scan-secrets.mjs          # 全仓库
node scripts/scan-secrets.mjs --staged # 只看暂存区
```

**协议文件里请用占位符**，真实密钥写在被忽略的 `*.local.json` 或直接填进 DX OS 界面：

```json
{
  "kind": "provider",
  "auth": { "type": "bearer", "apiKey": "YOUR_API_KEY" }
}
```

> 注意：钩子只能拦住"还没提交"的密钥。**已经被提交过的密钥，等于已经泄漏到 git 历史**，必须去服务商后台吊销并重新签发，光删文件没用。

---

## 仓库内容

| 路径 | 内容 |
| --- | --- |
| `SKILL.md` | 技能主清单：可执行清单 + 硬约束速查表（AI 助手加载的入口） |
| `README.md` | 本文件：完整说明文档（原理、工具用法、硬约束、排查手册） |
| `bin/*.mjs` | 9 个脚本 = 1 个共用路径模块 + 7 个校验/取证工具 |
| `references/onboarding-playbook.md` | 从零接入一家上游的完整作业手册 |
| `references/*.example.json` | 工具配置模板 + 探针样例输入 |

> 以上路径均相对于 `skills/dxos-protocol-authoring/`。

---

## 更新日志

### 本版（2026-09-14）

| 变更 | 说明 |
| --- | --- |
| ✅ **技能包与本文档同步校准** | 全部示例路径统一为 Windows 实际路径（`C:/Users/<用户名>/…`），不再残留作者本机路径；目录树、工具章节数、作业流程关数三者对齐（**8 个 bin 脚本 + 1 个路径模块 = 其 7 个需手动调用的校验/取证工具**） |
| 📌 **补齐 4 条实测用法陷阱**（本次踩到） | ① `verify-protocol` / `assert-param-guards` **必须带 `--experimental-transform-types`**（要 import 引擎 `.ts`），否则 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`；② `protocol-hash` 仓库体检**必须带 `--verify-store`**，直接传目录会报 `EISDIR`；③ `probe-local-input` / `probe-ratio` **只对图片档案有输出**——拿纯视频协议（如佳速）跑会输出 `0 条` / `共 0 组`，这是**正常空结果，不是脚本坏了**；④ 这两个探针的参数序是 `<model.json> <provider.json>`（先模型后平台），传反不报错但跑不到东西 |
| ✅ 全链路回归实测 | 7 个工具逐个跑通：`verify-protocol` 300 组 0 失败 / `assert-param-guards` 12615 项 0 越界 / `protocol-hash --verify-store` 8 版本 0 不符 / `audit-semantics` 正常 / `probe-local-input` 七牛 6 条全通 / `probe-ratio` 七牛 36 组全通 / `probe-panel` 佳速 6 模型全解析 |

### 上一版（2026-09-13）

| 变更 | 说明 |
| --- | --- |
| ➕ 新增 `bin/dxos-paths.mjs` | 运行时路径**自动探测**：扫各盘 `DXOS-Portable-*-win-x64` → 取版本最高者 → 读 `.dx-runtime/.active-runtime` 定位在跑的运行时。此前多个脚本里硬编码 `DXOS-Portable-0.2.0`，DX OS 升到 0.3.x 后**整条链路 ERR_MODULE_NOT_FOUND 全挂**。现在不带任何环境变量即可运行，升级 DX OS 也不用改脚本 |
| ➕ 新增 `bin/probe-panel.mjs` | **参数面板逐格探针**（第 4 层校验）。以前"界面上少格子/一格都没有"只能靠人工在画布上挨个点，脚本化后能自动抓。它直接读已安装的 `data/providers.json` 里绑定到该协议的**真实模型名**，按工具条顺序打印 `duration=/aspect_ratio=/resolution=/generate_audio=` 有/无，档案未命中直接 exit 1 |
| ➕ 新增 `bin/inspect-request-body.mjs` + `references/request-fixture.example.json` | **真实请求体取证器**（第 ⑧ 个工具）。与 ① 分工：① 用内置探针**压测取值合法性**（body 截断 300 字）；⑧ 用**真实 prompt + 真实素材 URL** 还原「实际会发什么」，输出**完整未截断 body** + `images` 形态判定（`{url,type=…}` / `裸URL`）+ prompt 里所有 `@引用`。内置 fixture 覆盖「四 intent × 带图 + 带音频」，专验首尾帧 `audios` 规则 |
| 🔧 破案新案例 | 佳速 `seedance-2.0-*` 参数面板**一格都不显示**：`modelProfiles.match` 只写了 `seedance-2.5-*`，站点里挂的 `seedance-2.0-933/-900` 前缀匹配不上 → 档案为 null → `resolveParameterSchema()` 返回 null → 工具条整块不渲染。**schema / 编译 287 组 / 覆盖率 100% 全绿，不报任何错**。修法：把站点真实存在的模型名前缀补进 `match`（见第九节） |
| 🔧 新增"少一格"的成因归类 | 「`match` 没覆盖站点模型名」与「`uiSchemas` 少 key」是**两种不同**的少格原因，前者更隐蔽（连 `duration` 都没有），必须用 ⑦ 才能提前发现 |
| ➕ 新增「异步任务重试」硬约束 | 速查表新增一行并给出精确机制：`retry` **只写在 operation 上才生效**（`compiler.ts:351` 拷进编译后的 request，`workflow.ts:237-256` 消费），不写 `retry.retryNetwork: true` 时 `totalAttempts` 默认 1、网络错误不重试 → **一次瞬时 `fetch failed` 就把已提交成功的异步任务永久判死**（实测佳速那次：26 分钟 / 267 次轮询，死在最后抖动） |
| ➕ 新增排查小节：「上游成功了，DX OS 却显示失败」 | 给出四字段判据表（`remote_task_id` 非空 / `poll_attempt` 很大 / `error_message` 是 `fetch failed` / `status=failed`）+ 三层根因链（`workflow.ts:519` → `ai-tasks/service.ts:214-221` → `ai-tasks/store.ts:157-162`）+ 引擎自身的设计矛盾（`index.ts:8830` 本来就有 5 秒一次的恢复调度，被架空） |
| ➕ 新增排查小节：「怎么证明参数/prompt 到底有没有发出去」 | 首选读 `plan_json.steps[].request.body`（编译后、`{{prompt}}` 已代入）；任务已经 `failed` 时改去画布库 `ccs.db` 做**逐字符保真度 diff**，并写明两处**预期内**差异（`@图[N]`→`@图片N`、末尾空行）——避免把正常归一误判成"丢内容" |
| 🔧 更正一条旧记录 | 旧文写「`plan_json` 有时为空」不准确：那是**转终态时被主动擦掉的**（同机 running/pending 任务的 `request_json` 2107 B / `plan_json` 3037 B 都完整）。所以硬规则是「**先查任务库，空串再去画布库**」 |
| 🔧 新增「算 hash 只能用 Node」 | `canonical()` 的对象键排序用的是 JS `localeCompare`（`repository.ts:37`），与 Python `sorted()` 不等价 → 用别的方式算的 hash 会被 `parseEntry` 静默丢弃 |
| ✅ 佳速修复版协议**实跑验证** | 轮询 122 次 / 平均 14.5 s（退避 5s→15s 生效）/ **>30 s 断档 0 次 / 网络错误 0 次**，完整等到上游终态并如实上报中文业务错误「内容审核未通过」；提示词 1032→1029 字**仅两处预期归一** |
| ➕ 新增 5.6「图片语义：参考图 vs 首帧」 | 揭出「**结果没遵循参考图**」的根因：`images` 每项带不带 `type` 决定语义强弱，而 **DX OS 对单图 i2v 只给 `role: reference_image`、从不给 `first_frame`**（`index.ts:3248-3252`）+ 模板层**没有 lookup**（无法按 role 条件省略字段）→ 只能**按 intent 拆 operation** + `$map` 显式构造。同节给出三种写法模板、四处 capability 联动清单，以及「别一刀切」（aicost 那种文档示例本身就裸 URL 的**不能**改） |
| 🔧 新增「首尾帧」能力 | 佳速补 `video.first_last_frame`：此前用户在画布点「首尾帧」+ 2 张图会直接报「没有匹配 video.first_last_frame 的 workflow」——**是个 UI 上可点到、但必然报错的坑**，现已打通（`submit.video.first_last` 透传 `role` → `first_frame`/`last_frame`） |
| 🔧 新增「多槽写入」手法 | `versions` 是**可容纳多槽的字典**，`saveProtocolV2` 只新增槽、绝不裁剪（`repository.ts:161-166`）。续跑任务按**版本号**取协议再比对 hash（`service.ts:187-188`）→ 所以新版本要写成**新增槽 + activeVersion 指过去、旧槽保留**，否则正在轮询的任务会以「固定版本已缺失或哈希不一致」全灭。已实测（runtime 0.3.6）多槽能稳定共存 |
| ➕ 新增 5.7「多参考也没遵循参考图 ≠ type 写错」 | **重要的归因纠偏**：`type` 语义只是**其中一条**成因。新增「同一症状 → 成因」判别表：**单图**不像 → 查 type；**多图（多参考）** 完全不像 → 先把 `images` 数组顺序 / `@图片N` 指向 / 参考图 URL 可达性三项对齐，再核对 **prompt 正文与参考图的内容是否冲突**。附佳速 2 图多参考实测：body 类型语义正确、`@图片1/@图片2` 指向也对，**根因是 prompt 写现代职场而参考图是古风汉服**，协议一个字不用改 |
| ➕ 新增硬约束：「首帧/尾帧时不能下发 `audios`」 | 官方文档明示（佳速 `佳速api开发文档.md`：使用 first_frame / end_frame 时不要同时传 audios）。`omitEmpty: true` **不会**兜住——只要用户挂了音频就会下发。故 `submit.video.first_frame` / `.first_last` 的 `bodyTemplate` 里**不写 `audios`**，只把 `audios` 留给 `submit.video`。给出「每个 intent 灌带图+带音频探针」的校验法 |
| 🔧 运行环境提示 | DX OS 运行时升到 **0.3.6** 后，`protocol-engine` 的 `.ts` 用了 TS 参数属性，Node 的 strip-only 模式会报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` → 所有校验脚本**必须**带 `--experimental-transform-types` |

---

## 一、这个技能解决什么问题

DX OS 的模型接入靠两份声明式 JSON（`schemaVersion: "dx-protocol/v2"`）：

- **平台协议**（`kind: "provider"`）——鉴权、Base URL、模型列表端点
- **模型协议**（`kind: "model"`）——能力、参数面板、请求体模板、响应捕获、轮询

这两份 JSON 由 DX OS 运行时里的纯函数编译器编译成执行计划。**手写时最容易掉进的坑是：协议"看起来对"，但实际跑不通**——因为大量错误是**静默失败**：

| 典型症状 | 真实原因 | 难查在哪 |
| --- | --- | --- |
| 导入成功、但版本没出现 | 版本条目的 `hash` 与内容不符，被静默丢弃 | 界面不报错 |
| 装了、覆盖率 100%、但面板少一格 | `uiSchemas` 写成了字段字典而非数组，或少了某个 key | 所有校验全绿 |
| 报"输出类型 undefined 不匹配" | `workflow.result.kind` 没写 | 报错文案指向 MIME，误导 |
| 请求里残留 `<capture:xxx>` | path 占位符键名 ≠ 响应捕获键名 | 报错在提交时才出现 |
| 上游 400 `must be an array of strings` | 素材用了裸 `{{inputs.images}}`（渲染成对象数组） | 编译期不报 |
| 上游 400 `invalid_resolution` | **界面参数串台**（图片页的 `1k` 带到了视频页） | 协议没错，是 UI 状态 bug |
| 装不进去，报 `models.method 不受支持` | provider 的 `models` 段缺失（schema 必填） | 文档没写就省略了 |
| 本地文件上传后静默丢失 | 写了不存在的 `workflow.steps`（正确字段是 `uploads`） | 不报错、不上传 |

**本技能的核心方法论：不靠猜，直接把协议丢进 DX OS 运行时自己的 `protocol-engine` 编译一遍，看最终发给上游的 body。**

配套三个离线工具，可以在**不进 DX OS、不发真实请求**的前提下，把上述所有坑提前跑出来。

---

## 二、安装与目录结构

### 安装

**方式 A：从 GitHub 克隆（推荐）**

```bash
git clone https://github.com/xiaoqi0102/dxos-skills.git
mkdir -p ~/.workbuddy/skills
cp -r dxos-skills/skills/dxos-protocol-authoring ~/.workbuddy/skills/
```

> 本仓库是**多技能集合**：每个技能各自一个目录，整体复制即可，不会互相干扰。
> 仓库里的 `README.md`（本文件）是说明文档，会一起复制过去，不影响技能加载。

**方式 B：从已有克隆复制**

```bash
# 假设你已有一份 dxos-skills 克隆，路径按实际情况写
cp -r "<dxos-skills 所在目录>/skills/dxos-protocol-authoring" "$HOME/.workbuddy/skills/"
```

（包内顶层已保留 `dxos-protocol-authoring/` 文件夹，解压后无需再改名。）

解压后应得到：

```
~/.workbuddy/skills/dxos-protocol-authoring/
├── SKILL.md                              # 主清单：可执行清单 + 硬约束速查表
├── bin/
│   ├── dxos-paths.mjs                    # ⓪ 运行时路径自动探测（其余脚本共用，不必手动调用）
│   ├── verify-protocol.mjs               # ① schema 校验 + 真机编译压测
│   ├── assert-param-guards.mjs           # ② 参数取值白名单断言
│   ├── protocol-hash.mjs                 # ③ hash 计算 + 协议仓库体检
│   ├── audit-semantics.mjs               # ④ 语义体检（静态分析，14 类规则 + 画布取值直传提示）
│   ├── probe-local-input.mjs             # ⑤ 本地素材路由探针（走官方 declarativeRouter）
│   ├── probe-ratio.mjs                   # ⑥ 尺寸取值矩阵探针（比例×分辨率，抓静默回落）
│   ├── probe-panel.mjs                   # ⑦ 参数面板逐格探针（抓「界面上少一格」）
│   └── inspect-request-body.mjs          # ⑧ 真实请求体取证（回答「到底发了什么」）
└── references/
    ├── onboarding-playbook.md            # 完整作业手册（从零接入一家上游）
    ├── param-guards.example.json         # ② 的配置模板（已含 6 个站点的真实配置）
    └── request-fixture.example.json      # ⑧ 的样例输入（四 intent × 带图 + 带音频）
```

> **数量口径**：`bin/` 下共 **9 个 `.mjs`**，其中 `dxos-paths.mjs` 是共用模块（被其余脚本 import，不单独调用），**需要手动调用的是 7 个校验/取证工具**：①→⑧（`protocol-hash` 的两种模式算同一个工具）。

`SKILL.md` 里的 `agent_created: true` 表明它由助手创建，可被后续会话直接加载和修改。

### 依赖

| 依赖 | 说明 |
| --- | --- |
| Node.js ≥ 22 | 建议用托管版本 `C:\Users\<用户名>\.workbuddy\binaries\node\versions\22.22.2-3\node.exe` |
| `--experimental-transform-types` | 必需。`validator.ts` 用了 TS parameter property，strip-only 模式会报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` |
| DX OS 运行时源码 | **自动探测**（`bin/dxos-paths.mjs`）：扫各盘 `DXOS-Portable-*-win-x64` → 取版本最高者 → 读 `.dx-runtime/.active-runtime`。可手动覆盖：`DXOS_ROOT` / `DXOS_SERVER` / `DXOS_ENGINE` / `DXOS_DATA` |

---

## 三、八个工具怎么用
> ⚠️ **路径必须用 Windows 风格**（`C:/Users/...`）。Git Bash 下写 `/c/Users/...` 并带 `MSYS_NO_PATHCONV=1` 时，node 会解析成 `c:\c\Users\...` 而报 ENOENT。（`MSYS_NO_PATHCONV=1` 本身是必须的，否则 node 收到的路径会被 MSYS 改写。）
>
> ⚠️ **运行时路径不用再指定了**：所有脚本都会调 `bin/dxos-paths.mjs` 自动定位 DX OS。只有在自动探测不到（装在非常规目录）时才需要设 `DXOS_ROOT`。

先设两个变量方便复用：

```bash
N="C:/Users/<用户名>/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
S="C:/Users/<用户名>/.workbuddy/skills/dxos-protocol-authoring/bin"
```

> ⚠️ **凡是 `import` 引擎 `.ts` 的脚本都必须带 `--experimental-transform-types`**：① `verify-protocol`、② `assert-param-guards`、⑤ `probe-local-input`、⑥ `probe-ratio`、⑦ `probe-panel`、⑧ `inspect-request-body`。
> 漏了会直接抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`（Node 的 strip-only 模式不支持 TS 参数属性），**看起来像脚本坏了，其实是少了这个 flag**。
> ③ `protocol-hash` 与 ④ `audit-semantics` 是纯 JS 静态分析，**不需要**该 flag（加了也无害）。

### ① `verify-protocol.mjs` —— schema 校验 + 真机编译压测

```bash
MSYS_NO_PATHCONV=1 "$N" --experimental-transform-types "$S/verify-protocol.mjs" \
  "<provider.json>" "<model.json>" \
  [--intent video.image_to_video] [--model-id <上游模型名>]
```

按顺序做三件事：

1. **schema 校验**（`validateProtocolV2`，即 DX OS 安装协议的第一关）——失败立刻终止并逐条打印。这一步专门拦"装不进去"类错误。
2. **按 intent 挑真正声明了该 workflow 的档案**——避免拿图片档案去编译视频 workflow（compiler 会静默回退到通用顶层 workflow，产生假阳性）。
3. **按该档案的有效 `assets` 规则生成探针素材**——`data_url` 给 `dataUrl`、`public_url` 给 `url`、`remote_name` 给 `name`。否则 `$dataUrlBase64` / `$files` 必然误报。

参数组合来自**从 Canvas 应用 bundle 里抽取的真实选项集**（含图片页残留值）：

```
视频分辨率  ['', '480p', '720p', '1080p']
图片分辨率  ['1k', '2k', '4k']
视频比例    ['16:9','9:16','1:1','4:3','3:4','21:9','9:21','keep_ratio','adaptive']
图片比例    ['1:1','2:3','3:2','3:4','4:3','9:16','16:9','21:9','9:21','source']
时长        [3,4,5,6,8,10,12,15,20,25,30]
```

**怎么判读输出**：

- 第一关逐份打印 `[通过]` / `[失败] <问题清单>`
- 之后每个 intent 一段，每组参数一行 `ok | ...` 或 `ERR | ... -> 原因`
- 最后一行 `=== 共 N 组，编译失败 M 组 ===`
- **有失败时进程 exit 1**，可直接接进批处理判断

不传 `--intent` 时遍历该模型协议的全部 `capabilities`（推荐）。

### ② `assert-param-guards.mjs` —— 参数取值白名单断言

```bash
MSYS_NO_PATHCONV=1 "$N" --experimental-transform-types "$S/assert-param-guards.mjs" \
  "C:/Users/<用户名>/.workbuddy/skills/dxos-protocol-authoring/references/param-guards.example.json"
```

**① 证明的是"协议能编译、引用没写错"；② 证明的是"编译出来的取值确实落在上游文档允许的集合内"——这才是真正防 400 的那一步。**

它的做法：把 `视频分辨率 × 图片分辨率 × 视频比例 × 图片比例` 全交叉（145 组）加全部时长档位喂进真机编译，递归扫描编译后 body（含 `metadata.payload` 这类 JSON 字符串）里的 `resolution` / `ratio` / `aspect_ratio` / `aspectRatio` / `duration` / `seconds`，断言每个取值都在配置声明的白名单内。

配置格式（模板见 `references/param-guards.example.json`）：

```json
{
  "baseDir": "",
  "targets": [
    {
      "label": "aicost / seedance2.5",
      "provider": "aicost/aicost.provider.json",
      "model": "aicost/aicost.model.json",
      "modelId": "seedance2.5",
      "intents": ["video.text_to_video", "video.image_to_video"],
      "allow": {
        "resolution": ["720p", "1080p", "1k", "2k"],
        "ratio": ["16:9", "9:16", "1:1"],
        "duration": { "min": 1, "max": 30 }
      }
    }
  ]
}
```

- `allow.resolution: null` 表示**上游不接受该字段**，出现即判失败。
- `modelId` 必须是 `modelProfiles[].match` 里的值。

> ⚠️ **必须做对照测试**：改协议前，先用 `baseDir` 指向一份旧版备份跑一遍，**确认断言器能报出越界**。否则你无法区分"协议真的干净"和"断言器写错了"。

### ③ `protocol-hash.mjs` —— hash 计算 + 仓库体检

```bash
# 单文件模式：打印 <hash>  <kind>/<id>  <路径>
MSYS_NO_PATHCONV=1 "$N" "$S/protocol-hash.mjs" "<protocol.json>" ...

# 仓库体检：逐条核对 hash 与 activeVersion，有问题的版本 exit 1
MSYS_NO_PATHCONV=1 "$N" "$S/protocol-hash.mjs" --verify-store "<data/custom-protocols-v2.json>"
```

**为什么需要它**：`repository.ts` 的 `parseEntry()` 会重算 hash 比对（第 60 行），对不上就**静默丢弃整个版本**——表现就是"导入成功但版本没出现"，这是最难诊断的一类问题。

该脚本的 hash 实现与官方 `canonical()` **逐字节一致**（对象按 key `localeCompare` 排序、数组保序，拼成 `{"k":v}` / `[a,b]` 后 sha256）。已对真实仓库 `data/custom-protocols-v2.json` 实测体检 **8/8 个版本 hash 全部一致**，证明复现正确。

> ⚠️ **仓库体检必须带 `--verify-store`**，直接把目录或站点 JSON 传进去只会报
> `[读取失败] … EISDIR: illegal operation on a directory, read`。仓库路径可由 `bin/dxos-paths.mjs` 的 `resolveDataDir()` 推出：
> ```bash
> MSYS_NO_PATHCONV=1 "$N" "$S/protocol-hash.mjs" --verify-store \
>   "<DXOS 根目录>/data/custom-protocols-v2.json"
> # 期望：体检完成：8 个版本，0 个 hash 对不上（会被静默丢弃）
> ```
> 注意 hash 模式**不需要** `--experimental-transform-types`（它不 import 引擎 `.ts`），加了也无害。

### ④ `audit-semantics.mjs` —— 语义体检（静态分析）

```bash
# 不传目录时自动定位（优先当前工作目录向上找项目根），也可显式传目录或用 PROTO_BASE
MSYS_NO_PATHCONV=1 "$N" "$S/audit-semantics.mjs"
# 显式指定：
MSYS_NO_PATHCONV=1 "$N" "$S/audit-semantics.mjs" "<协议根目录>"
```

**为什么需要它**：前三关（schema / 编译 / 取值）对付的是"装不进去""编译不过"和"取值越界"。但还有一类问题**能装、能编译，功能却是坏的**——不报任何错，只是某个功能静默失效。比如档案级 `uiSchemas` 写成字典（参数面板一格都不显示，但覆盖率仍显示全绿）、`response` 里键名写错（引擎不认识就丢弃）、selector 用 `$.a[].b`（0.3.3 根本不解析）。这类问题只能靠静态规则比对发现。

规则与 `validator.ts` 逐条对齐，覆盖 14 类检查：

| 检查项 | 不查会怎样 |
| --- | --- |
| 档案级 `uiSchemas` 必须是 `string[]` | 写成字典 → 参数面板一格不显示，覆盖率仍全绿 |
| `response` 键 ∈ 引擎白名单（14 个） | 键名写错 → 静默丢弃 |
| selector 正则（`[]` 不被 0.3.3 解析） | `$.a[].b` → 该字段永远取不到 |
| 模板表达式正则 + 根变量白名单 | `{{inputs.images.*.url}}` → 非法模板 |
| `$cardinality` 必含 `from/zero/one/many` | 缺 `one` → 装不进去 |
| workflow 引用完整性 | `submit` 指向不存在的 operation → 提交即失败 |
| capability 是否有人实现 | 顶层声明了却无 workflow / 档案映射 → 选了就失败 |
| path 占位符来源 | 既非模板根变量也非 capture 键 → 原样发出 `<capture:x>` |
| 素材模式 vs 操作原语 | 用 `$dataUrlBase64`/`$files`/multipart 却声明 `public_url` → 报错 |
| 素材模式 vs Canvas 本地素材 | `public_url`/`remote_name` 接不住只有 dataUrl 的本地素材 → 本地图生图必 409（见 5.3） |
| `upload_operation` 是否有配套 `workflow.uploads` | 缺上传步骤 → 本地素材永远传不上去 |
| `limits.references` 嵌套结构 | 平铺写法谁也读不到 |
| 档案 `match` 是否重叠 | 两个档案匹配同一模型名 → 解析歧义 |
| 孤儿 operation | 写了却没人引用 → 残留死配置 |

**判读输出**：顶部一行统计，然后按类别分组列问题，末尾可选"提示级"（非错误，如冗余的 `data_url`）。**有问题时 exit 1**。

> ⚠️ **同样必须做对照测试**：往副本里注入几类缺陷（空方括号 selector、`$cardinality` 缺 `one`、档案级 `uiSchemas` 写字典、`submit` 指向幽灵 operation），确认全部被抓到，再信它的"通过"。

### ⑤ `probe-local-input.mjs` —— 本地素材路由探针

```bash
MSYS_NO_PATHCONV=1 "$N" --experimental-transform-types "$S/probe-local-input.mjs" \
  "<model.json>" "<provider.json>"
```

**为什么需要它**：这是唯一一个**走官方代码**、直接复现画布 409 的探针。它 import 运行时的
`server/ai-tasks/declarativeRouter.ts`，用 **Canvas 默认本地素材的真实形态**
（只有 `dataUrl`/`mime`/`name`/`bytes`，没有 `url`、没有 `remoteName`）去跑
`standardProtocolTaskFromAiTask()` —— 这正是 `unsupported_local_input` 的判定函数。
每个模型档案 × `image.generate` / `image.edit` 各跑一次，通过后再编译出 body，
检查图生图链路确实带上了 `data:` 开头的素材。

输出：

```
[FAIL] gpt-image-2 / image.edit
       本地素材过不了素材规则 → 路由回落 legacy → Canvas 直接 409 unsupported_local_input
[ok  ] gpt-image-2 / image.edit -> image.edit.gpt / edit.gpt
       body: {"prompt":"…","image_urls":["data:image/png;base64,iVBOR…"],"image_size":{…}}
```

**改素材规则前后各跑一次**，拿到的就是"修好了"的直接证据（不是靠读代码推断）。

> ⚠️ **两个容易误判成"脚本坏了"的点**（2026-09-14 实测补录）：
> 1. **只对图片协议有输出**。脚本内层只遍历 `image.generate` / `image.edit`，纯视频协议（如佳速，capabilities 全是 `video.*`）会被跳过，输出 `>>> 0 条链路全部接受 Canvas 本地素材` —— 这是**正常的空结果**。要验视频协议的素材链路请用 ⑧ `inspect-request-body.mjs`。
> 2. **参数序是 `<model.json> <provider.json>`**（先模型后平台）。传反了不会报错，但跑不到任何东西。

### ⑥ `probe-ratio.mjs` —— 尺寸取值矩阵探针

```bash
MSYS_NO_PATHCONV=1 "$N" --experimental-transform-types "$S/probe-ratio.mjs" \
  "<model.json>" "<provider.json>"
```

**为什么需要它**：它专抓一类前三关和 ④ 都拦不住的问题 —— **能出图、不报错，但用户选的参数根本没生效**。

它把画布真实会发出去的组合逐组灌进官方编译器：比例取声明枚举前几项 + 两个「非枚举」样例
（`source` 和 `1055:1491`，即「原图比例」的实际下发值），分辨率取小写 `1k / 2k`，
**兼容三种 body 形态**（`size:"WxH"` 字符串 / `image_size:{width,height}` 对象 / 嵌套 `generationConfig.imageConfig`），然后检查五件事：

| 检查 | 抓什么 |
| --- | --- |
| A 回落检测 | 非标准比的输出与 `1:1` **完全相同** → 被静默回落（用户选了原图比例，拿到正方形） |
| B 分辨率生效 | 同一比例下 `1k` 与 `2k` 输出相同 → 分辨率没传进去 |
| C 比例一致 | 输出 `"WxH"` / `{width,height}` 的宽高比与注入比例偏差 > 3%（仅对声明枚举比检查） |
| D 枚举合法 | 回给上游的**分辨率**字段落在协议声明枚举之外（**大小写敏感**）→ 明确 bug |
| E 非标比处置（**提示级**） | 非标准比被**原样透传** → 记一条提示：Gemini 系 relay 会就近映射（实测 3:7→9:16），这是最优可得；只有被改成"既非声明值、又非原样"的怪值才 FAIL |

输出：

```
[FAIL] gpt-image-2 非标准比「1055:1491」被静默回落
       输出与 1:1 完全相同（{"width":1024,"height":1024}）——画布的「原图比例」正是走这条路
[FAIL] gpt-image-2 「1:1」下 1k 与 2k 输出相同
       均为 [{"width":1024,"height":1024},null,null] —— 分辨率没有生效
[提示] change2pro-banana 「1055:1491@2k」 ...aspectRatio 原样透传非标准比「1055:1491」
       上游会就近映射到最接近的标准比（实测 3:7 → 9:16），不算错
```

**必做对照测试**：拿改前的备份跑必须 FAIL，跑改后的文件必须全绿。七牛实测：改前 37 项 FAIL → 改后 0 项。
⚠️ 探针只能做**静态推断**；E 项提示里「这个上游到底会不会就近映射」必须再用一张 `300×700`（3:7）参考图线上实测一次才能定案（详见 5.5）。

> ⚠️ 同样**只对图片档案有输出**：纯视频协议会输出 `>>> 共 0 组，尺寸取值全部随用户选择正确变化`，属**正常空结果**。
> 参数序同为 `<model.json> <provider.json>`。
> 2026-09-14 实测七牛：36 组全部通过，`source` 与 `1055:1491` 均正确归一为 `auto`。

### ⑦ `probe-panel.mjs` —— 参数面板逐格探针（2026-09-13 新增）

```bash
MSYS_NO_PATHCONV=1 "$N" --experimental-transform-types "$S/probe-panel.mjs" \
  "<model.json>" "<provider.json>" [--models a,b,c]
```

**为什么需要它**：这是**第 4 层校验**（5.2 节那个"少一格"问题）。前六关全过、覆盖率全绿，界面上照样可能**整块面板不渲染**——而且**不报任何错**。以前只有"在画布上挨个点"这一条路，遇到"一格都没有"时你甚至不知道该点哪里。

它直接调用运行时自己的 `resolveProtocolModelProfile()` / `resolveParameterSchema()`，**候选模型名默认从已安装的 `data/providers.json` 里读**（读出所有绑定到该模型协议的站点模型名），所以核对的就是用户实际会选到的那份清单 —— **不需要先把协议装进 DX OS**。

判定规则与 Canvas 工具条一致（逐格判 key 是否存在），输出：

```
协议: jiasuapi   站点绑定到该协议的模型: 5 个
工具条顺序: [模式] [生成音频] [时长] [画面比例] [分辨率] [更多参数]

[档案未命中] seedance-2.0-933
      模型名不以任何 modelProfiles[].match 值开头 → 参数面板一格都不显示（本条即 FAIL）
      当前档案: jiasu-video(seedance-2.5-101010|seedance-2.5|kling-v1|kling)
[ok] seedance-2.5-900  → 档案 jiasu-video
      video.image_to_video     [duration=有 aspect_ratio=有 resolution=有 generate_audio=无]  更多参数=[]
      video.text_to_video      [duration=有 aspect_ratio=有 resolution=有 generate_audio=无]  更多参数=[]

>>> 5 个模型中 0 个解析不出参数面板
```

两条硬判据：

- **`[档案未命中]` 直接 exit 1**。根因是 `modelProfiles[].match` 没覆盖站点里真实的模型名前缀 —— 修法就是把站点真实模型名补进 `match`（**前缀命中**，`seedance-2.0` 即可覆盖 `seedance-2.0-933` / `-900`）。
- **`generate_audio=无` 只有在上游确实没这个参数时才是对的**。佳速 `/v1/video/generations` 没有该字段，就**不要**为了让格子好看而瞎加 `uiSchemas` 字段 —— 加了又不进 `bodyTemplate`，等于给用户一个假开关。

> ⚠️ 改 `modelProfiles.match` 或 `uiSchemas` 后**必跑**。它也是唯一能在"装进 DX OS 之前"就发现"面板全空"的工具。

---

### ⑧ `inspect-request-body.mjs` —— 真实请求体取证（2026-09-13 新增）

回答用户那句最常问的「**到底实际发了什么**」的首选工具。

和 ① 的分工要说清：

| | ①`verify-protocol.mjs` | ⑧`inspect-request-body.mjs` |
| --- | --- | --- |
| 输入 | 内置探针矩阵（假的 `example.com` 素材） | **你给的真实 prompt + 真实素材 URL** |
| 目的 | **压测取值合法性**（分辨率/比例/时长是否越界） | **还原「实际会发什么」** |
| body | 截断显示前 300 字 | **完整、未截断** |
| 额外 | — | `images` 形态判定 + prompt 里所有 `@引用` |

```bash
node --experimental-transform-types bin/inspect-request-body.mjs \
  <provider.json> <model.json> <fixture.json> \
  [--intent <cap>] [--model <上游模型名>] [--base <baseUrl>] [--only <name 子串>]
```

`fixture.json` 与 ① 的 `--tasks` 同格式：`[{ intent, name, prompt, params, inputs }]`。

**内置样例** `references/request-fixture.example.json` 覆盖「四 intent × 带图 + 带音频」，专验 5.7 的 `audios` 规则。实跑输出：

```text
case  : ① 单图 i2v + 附音频 → 期望 body 里【无】audios，images 带 type=first_frame
intent: video.image_to_video    model: seedance-2.5-101010    profile: jiasu-video
request: POST https://example.invalid/v1/video/generations
images 形态:  → 共 1 项：[{url,type=first_frame}]
prompt: 15 字 | 引用标记 1 个: ["@图片1"]
audios: （未下发）
────────────────────────────────────────────────────
case  : ③ 多图多参考 + 附音频 → 期望 body 里【有】audios，images 为裸 URL 数组
images 形态:  → 共 3 项：[裸URL, 裸URL, 裸URL]
audios: ["https://example.com/voice1.mp3"]
```

**`images 形态` 是它的核心价值**：把每项压成 `{url,type=…}` / `裸URL` 这样的短标识 ——
一眼看出**是参考图还是首帧**、**有没有被偷偷补上 `name`**。这正是「结果没遵循参考图」类投诉最快的一步取证（配合 5.7 的归因判表）。

实测（佳速真实任务 78082d75，`--model seedance-2.0-900`）：`prompt: 1169 字 | 引用标记 5 个: ["@图片2","@图片1",…]`、`images 形态 → 共 2 项：[裸URL, 裸URL]`、`audios: （未下发）` —— 与该任务当时的实际请求逐项吻合。

> ⚠️ 真实任务的 fixture 里常含**会过期的临时素材 URL**（如 `api.dx-os.com` 的 24h 链接），属**一次性取证材料，用完即弃**；
> 要长期保留就只留「输入结构」，把 URL 换成 `example.com` 占位（内置样例就是这么做的）。

---

## 四、标准作业流程

```
0. 读上游文档，先产出「接口事实表」→ 交用户确认
1. 写两份 JSON（provider + model）
2. 离线校验（**核心七关**）：`verify-protocol`（①）→ `assert-param-guards`（②）→ `audit-semantics`（④）→ `probe-local-input`（⑤，有参考素材必跑）→ `probe-ratio`（⑥，有图片档案必跑）→ `probe-panel`（⑦，有 `modelProfiles` / `uiSchemas` 必跑，防"面板少一格"）；需要写库时再跑 `protocol-hash --verify-store`（③）。有「到底发了什么」类疑问随时用 ⑧ 取证
3. 退出 DX OS → 备份 → 写入 custom-protocols-v2.json（hash 必须先核对）
4. 配 providers.json（站点 → 平台协议 id；模型 → 模型协议 id；caps 填能力）
5. 重启 DX OS → 状态 ready、覆盖率 100% → 画布逐格核对 → 真跑一条最小任务
6. 交付：列明绝对路径 + 各层验证结果 + 没做到的部分
```

> 也可以在界面上「导入协议」直接选文件导入（导入端自己算 hash，随导随生效，不必重启）——
> 前提是导入的 JSON 已过完第 2 步。

### 第 0 步为什么重要

事实表要把这些抄清楚：鉴权方式、Base URL 有无 `/v1` 段、同步还是异步、提交/查询端点与方法、`Content-Type`、任务 ID 占位样貌、素材上传端点、**请求字段的准确名与别名（哪个真正生效）**、返回体键名（ID/状态/直链/错误）、模型清单（时长/比例/分辨率/素材上限/是否必须带图/是否出声）、支持的能力枚举、素材是公网 URL 还是需先上传。

**抄不到的标「手册未写」并来问用户，不要用经验填空。** 事实表先发用户确认，再写 JSON。

---

## 五、核心知识：写协议必须记住的约束

### 5.1 硬约束（0.3.3 实测，写错多半静默失败）

| 规则 | 说明 |
| --- | --- |
| `workflow.result.kind` | **必填** `image`/`video`/`audio`，缺了报"产物 MIME 与输出类型 undefined 不匹配" |
| 模型协议 `id` == 平台协议 `id` | 不相等不会自动绑定 |
| provider 的 `models` | **必填**（`types.ts:149` 非可选）。缺了报三条：`models.method 不受支持` + `models.path 必须是相对路径、HTTPS，或 localhost HTTP` + `models.response 缺失`。标准写法 `{ "method": "GET", "path": "/v1/models", "response": { "data": ["$.data", "$.models"] } }` —— **手册没写模型列表端点也要补，这是 schema 硬要求** |
| operation id | 必须匹配 `/^[a-z0-9][a-z0-9:_-]{1,63}$/`，即**全小写**。`faceStyle` 这类驼峰报"operation id 无效"，改完记得同步 workflow 里的 `submit` 引用 |
| `$cardinality` | 必须含 `from` `zero` `one` `many`，只能额外含 `two`；少一个 `one` 直接校验失败 |
| `inputs` 只有四个分组 | `images` / `videos` / `audios` / `files`。文档里的"首帧/尾帧/参考图"是素材的 `role` 字段，**不是分组**。写 `{{inputs.first_frame}}` → 求值 UNDEFINED → 报 `$map.from 必须渲染为数组`。首尾帧正确做法：`{{inputs.images[*].url}}` 配 `{{inputs.images[0].url}}` / `{{inputs.images[1].url}}` 按下标取 |
| `$map` | 只允许 `from` + `template`，且 `from` 必须渲染成**数组**（路径含 `[*]` 才是数组） |
| 模板变量根名白名单 | `model prompt params inputs provider captures derived`。`{{items[0]}}` / `{{items.0}}` **非法** |
| 模板正则 | `^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*\|\[(?:\*\|\d+)\])*$` |
| 素材数组 | body 里要字符串数组时写 `{{inputs.images[*].url}}`；裸 `{{inputs.images}}` 渲染成**对象数组** |
| `$map` 的 `from` / `$files` | 必须保留**裸引用** `{{inputs.images}}`（要对象数组，`item.dataUrl`/`item.mime` 才可用），不要批量替换成 `[*].url` |
| 素材规则 `assets.<kind>.mode` | Canvas 默认的本地素材**只有 `dataUrl`**（`canvasAssets.ts:58-68`）。图片类一律 `data_url` + 读 `{{inputs.images[*].dataUrl}}`；写 `public_url` 会让本地图生图直接 409（详见 5.3.1） |
| path 占位符 | `{taskId}` 里的键名必须 == `response` 捕获键名，**不是上游字段名**。名字对不上会残留 `<capture:...>`。`pathParams` 不是 v2 字段 |
| selector | 只认 `$.data[*].url` / `$.data[0].url` / `$[*]`；**空方括号 `$.data[].url` 完全不被解析** |
| `workflow.uploads` | 素材上传的**唯一机制**。`workflow.steps` 是不存在的字段——**写了不报错也不上传，本地文件静默丢失** |
| 响应映射键名 | 只有 `taskId` / `status` / `progress` / `errorCode` / `errorMessage` 会被持久化；结果直链声明为 `resultUrl` / `resultUrls` |
| `omitEmpty: true` | 逐层剥离 `undefined / null / '' / [] / {}` |
| `params` 合并顺序 | `{...profile.defaults, ...task.params}`——**任务侧覆盖 defaults**，UI 传什么就是什么（这是参数串台的成因） |
| 画布比例的取值 | 选「原图比例」时发的是 **GCD 约分后的具体比**（如 `1055:1491`，不是字面量 `source`）；分辨率一律**小写** `1k/2k/4k`。所以：①`lookup` 只做字面量精确匹配，非枚举值要么给 `fallback`、要么原样透传（上游就近映射）；②分辨率直接透传给枚举型上游 = **静默失效**（上游要大写 `2K`）。三种归宿与实测判据见 5.5 |
| 条件分支 | 引擎没有 `if`。模板层用 `$coalesce`（取第一个渲染后非空的结果）+ `$keyValue`（key 为空串时返回 `UNDEFINED`）组合成开关；`lookup` 不给 `fallback` 时返回 `undefined`，能让某字段在请求里整个消失（如 `image_size` 缺省 → 上游用 auto） |
| 别名 | 文档给了别名（`ratio` / `aspect_ratio` 等价）时选标注"推荐/实际生效"的那个，其余当兼容候选写进 `$coalesce`，**别同时下发多个别名** |
| 安全 | 协议文件里**绝不写真实令牌/用户数据**，用 `credentialRef` 引用 |

### 5.2 UI 参数面板：`uiSchemas` / `limits` / 逐格渲染

**`uiSchemas` 的值必须是"字段数组"**，字段键是 `key`（不是 `param`）：

```json
"uiSchemas": {
  "my-params": [
    { "key": "duration", "label": "时长", "type": "number", "default": 5, "min": 1, "max": 30, "step": 1 }
  ]
}
```

Profile 用 `"uiSchemas": ["my-params"]` 按 id 引用。合法 `type`：`select | number | slider | toggle | text | textarea | json`。

> ⚠️ 写成 `{ "duration": {...} }` 这种"字段名字典" → 不是数组 → `resolveParameterSchema` 返回 null → **参数面板一格都不显示**（但覆盖率仍全绿）。源码另有未见于文档的字段 `showWhen: { models: ["xxx"] }`，可按模型控制某格显隐。

**每一格是"单独判存在性"**：画布视频节点工具条按固定顺序渲染 `[模式按钮] [生成音频] [时长] [画面比例] [分辨率] [更多参数]`，它逐个看"参数 schema 里有没有这个 key"，**找不到就整格不渲染**。所以需要这几格时，`uiSchemas` 里必须同时有 **`duration`、`aspect_ratio`、`resolution`、`generate_audio`**。

> ⚠️ **这种"少一格"不会让任何校验报错**：结构校验通过、覆盖率 100%、执行模拟全过，界面上照样缺。每次改 `uiSchemas` 都要做逐格核对 —— **现在有脚本了：⑦ `probe-panel.mjs`**。

**"少一格"其实有两种成因，第二种更隐蔽：**

| 成因 | 症状 | 起点面板长这样 |
| --- | --- | --- |
| `uiSchemas` 里少了某个 key（如只写 `duration` 没写 `aspect_ratio`） | 只缺那一格，其他格正常 | 有时长、没比例 |
| **`modelProfiles[].match` 没覆盖站点里的真实模型名** | **整块面板一格都没有**（`resolveParameterSchema()` 返回 null） | 只剩「智能多参 / 首尾帧」两个固定 chip |

第二种是 2026-09-13 佳速实测踩到的：站点挂的是 `seedance-2.0-933 / -900`，档案 `match` 只写了 `seedance-2.5-*` 与 `kling` → 选中 `seedance-2.0-*` 时**时长/比例/分辨率全都不显示**（没有任何报错）。改法：把站点真实存在的模型名前缀补进 `match`。**跑 ⑦ 前后对照即可看到 `[档案未命中]` → `[ok]`。**

**`limits` 结构**：

```json
"limits": {
  "references": { "images": { "max": 9 }, "videos": { "max": 3 }, "audios": { "max": 3 } },
  "resolution": { "options": ["720P"], "default": "720P", "readonly": true },
  "features": { "generate_audio": false }
}
```

- **`references` 必须嵌套**（`modelDescriptor.ts:60,73` 读的是 `object(limits.references)[kind]`）。写成平铺的 `limits.images` 不被任何代码读到 → 张数上限形同虚设。
- 档位写 `{ "options": [...], "default": ... }`；`{ "fixed": 15 }` / `{ "enum": [...] }` 是自造键，不被识别。
- `limits.features[key] = false` 是把字段**删掉**，不是置灰。

**`limits` 是 Profile 级的，不是模型级的**。一条 Profile 覆盖多个取值不同的模型时，面板只能显示一个默认值。→ 按"同一组取值"把 Profile 拆开。

**`modelProfiles` 用字典形态**（写成数组会导致 Profile 校验被静默跳过）。Profile 匹配是**前缀命中 + 取第一个** → **笼统档必须排在具体型号之后**，否则具体型号会被笼统档冒名接管。

### 5.3 素材交付模式（`assets`）：最容易写错的地方

运行时取规则时**档案级优先**（`server/ai-tasks/declarativeRouter.ts:49`）：

```ts
return profile?.assets?.[key] || protocol.assets?.[key]
```

| `assets.mode` | 含义 | 何时用 |
| --- | --- | --- |
| `upload_operation` | 协议自己上传，素材对象上得到上传返回的键；**必须**配套 `workflow.uploads` | 上游有上传端点时最通用：本地文件 + 公网 URL 都能接 |
| `data_url` | 内联 base64 提交（本地文件直接用，远程 URL 会自动下载再转 Base64） | **图片类默认选它**；走 `$dataUrlBase64` / multipart `$files` / `{{inputs.images[*].dataUrl}}` 的链路 |
| `public_url` | 只收公网 http(s) | 上游只要 URL。**代价见 5.3.1** |
| `remote_name` | 上游只认文件名 | 少见（同样接不住本地素材） |

#### 5.3.1 头号坑：Canvas 默认的本地素材**只有 dataUrl**

画布上传/生成的素材，运行时经 `ai-tasks/canvasAssets.ts:58-68` 解析出来只有：

```ts
{ assetId, kind, dataUrl, mime, name, bytes }   // 没有 url，没有 remoteName
```

`url` / `remoteName` 只有在**用户把输入卡片的素材来源切成「公网 URL」**时才出现
（canvas 1.0.112 的 `Z3()`：卡片媒体 mode 必须是 `url` 且 `/canvas/public-media` 上传成功，
状态 `valid`/`expiring`）。默认状态下**没有**。

所以 `public_url` / `remote_name` 规则必然让 `protocolAsset()`（`declarativeRouter.ts:94-105`）返回 `null`
→ `standardProtocolTaskFromAiTask()` 返回 `null` → 路由回落 legacy → `index.ts:3773` 直接 **409**：

```
canvas Surface 只允许已精确启用的声明式协议，当前不可执行：unsupported_local_input
如果该平台尚未完成新协议迁移，可尝试打开画布右上角的「兼容模式」后重新生成。
```

> **这条提示里的「兼容模式」是误导**：它只是把同一份协议交给更老的执行器重跑一遍，
> 本地素材照样送不出去。真正的修法是让素材规则能接住 dataUrl。

**图片素材的正确写法**：`assets.images.mode = "data_url"`，body 里读 `{{inputs.images[*].dataUrl}}`。
体积大的视频/音频若坚持 `public_url`，必须接受"用户得先把输入卡片切成公网 URL 才能用"这个前提，
并在交付说明里写清楚。

**实测（2026-09-11，api.qnaigc.com）**：`POST /queue/openai/gpt-image-2/edit` 的 `image_urls`
**直接接受 `data:image/png;base64,...`**（200 IN_QUEUE → 最终 COMPLETED）。
所以 fal 队列这类文档里写"参考图 URL"的接口，其实也吃 Data URL —— 别想当然地给它配 `public_url`。

| 协议里用到的写法 | 必须的模式 | 写错的报错 |
| --- | --- | --- |
| `$dataUrlBase64`（Gemini `inlineData.data`） | `data_url` | `$dataUrlBase64 必须渲染为 Data URL 字符串` |
| multipart 里的 `$files` | `data_url` | `multipart 文件必须来自已解析的 Data URL 素材` |
| `{{inputs.images[*].url}}` / `{{item.url}}` | `public_url` | 渲染成 undefined |
| `{{item.name}}` | `remote_name` | 渲染成 undefined |

**同一模型协议里既有走 url 的视频链路、又有走 Base64 的图片链路** → 顶层写 `public_url`，只在需要的档案里覆盖：

```json
"modelProfiles": {
  "xxx-image-gemini": {
    "match": ["gemini-3-pro-image-preview"],
    "capabilities": ["image.generate", "image.edit"],
    "assets": { "images": { "mode": "data_url" } }
  }
}
```

> ⚠️ 两个反直觉点：
> 1. `declarativeRouter.ts:93`——**档案一旦声明了 `assets`，没覆盖到的素材类型会被静默丢弃**（`if (profile?.assets && !rule) return null`）。档案级 `assets` 要把该档案会收到的类型写全。
> 2. 图片档案**必须** `data_url`（否则本地图片直接 409，见 5.3.1）；视频档案若写 `public_url`，要明确告诉用户"参考视频/参考音频得把输入卡片切成公网 URL"。只写协议级 `public_url` 会保住视频、悄悄写坏所有图片链路。
> 3. 顺手一个反例：顶层 `public_url` 但**图片档案覆盖 `data_url`** 的协议（aicost 图片）是能用的；而顶层与档案都没覆盖到的图片链路（如某些视频档案里的 `images`）就会 409 —— 这正是 `audit-semantics.mjs` 新增规则抓的那类问题。

### 5.4 参数串台：必须加兜底

「API 生成」面板由内置 Canvas 应用渲染，它的 `resolution` 等参数状态**在图片页和视频页之间共享**。在图片页选过 `1k` 再切到视频页，请求里就会带 `"resolution": "1k"` → 上游只支持 `480p/720p` 的视频模型直接 400 `invalid_resolution`。

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

> ⚠️ **必须用「白名单 + fallback」，不要枚举非法值**：`lookup` 的 `fallback` 接住**所有**未列出的取值（含 `2:3`/`3:2`/`source` 这类图片页比例、以及 UI 以后新增的选项）。`cases` 只列**上游允许的值**，其余一律交给 `fallback`。
>
> ⚠️ `clamp` 内部的 `finiteNumber()` **遇到非数字会抛错**，所以必须先 `coalesce` 给字面量兜底，不能裸 clamp `params.duration`。
>
> ⚠️ **多个档案共用同一个 operation 时，兜底会互相打架**：`derive` 挂在 operation 上，两个档案的合法集合互斥时（一方合法值恰好是另一方的非法值），一个 operation 不可能同时兜对，必须拆。判据：把各档案的合法集合摆出来，**只要存在「A 合法而 B 非法」的值，就拆**。

### 5.5 图片尺寸：选「原图比例」出正方形（2026-09-11 七牛实测）

**现象**：画布「系统参数」里比例选「原图比例」、分辨率选 `2K`，生成出来的却是 1:1 正方形。

**根因**：画布的两个取值都不在协议枚举里，`lookup` 精确匹配失败后**静默走 fallback**：

| 画布发的 | 协议原来认的 | 后果 |
| --- | --- | --- |
| `aspect_ratio: "1055:1491"`（原图比例 → GCD 约分后的具体比） | 只列了 `1:1 2:3 3:2 3:4 4:3 9:16 16:9 21:9 5:4 4:5` | fallback `1` → **长宽相等 → 正方形** |
| `resolution: "2k"`（小写） | 只列了 `"1K":1024, "2K":2048` | 落到兜底 literal → **2K 请求实际出 2880** |

选「原图比例」时客户端**不会**把字面量 `source` 发出来，而是先按输入图真实宽高做 GCD 约分再填进 `params.aspect_ratio`：

```js
// Canvas 1.0.112 内置 bundle 反查所得
Xd(t) => t.params.ratio === "source" ? qy(t) : t.params.ratio || "1:1"
qy(t) => GCD 约分后 `${w/g}:${h/g}`   // 实测发出 "1055:1491"
hr(t) => "1k" | "2k" | "4k"           // 小写，不是 uiSchemas 里声明的大写 "2K"
```

顺带一提：`params.size`（`"1024x1024"`）也是画布按它**内置表**算的，`source` 时同样回落到 `1:1` 的表值，**不能当权威值用**。

**修复：先用线上实测判定「非标准比」的归宿，再动手。** 2026-09-11 在三个站点各跑一遍
（参考图 `300×700` = 3:7 ≈ 0.4286，1K 档），得到**三种不同答案**：

| 归宿 | 站点 / 上游 | 实测成图 | 评价 |
| --- | --- | --- | --- |
| `size:"auto"` | aicost `gpt-image-2` edit | 822×1913（0.4297） | ✅ **精确跟随原图，最优** |
| **原样透传**具体比 | change2pro（Gemini relay） | 768×1376（0.5581 = 9:16） | ✅ **上游就近映射到最接近的标准比，最优可得** |
| 白名单归一 → `auto` | 七牛 fal gemini | `auto` 生效 | ✅ 该上游明确支持 `auto` |

**反面教材（实测证明没用，别抄）：**
- 枚举型上游**省略** `aspectRatio` 字段 → change2pro 出 **1024×1024（1:1）**，等于没选；
- 给枚举型上游 **`aspectRatio:"auto"`** → change2pro 同样 **1:1**（`auto` 不是它的合法值，被静默忽略）。

**所以判据不是"猜上游类型"，而是真跑一次量像素**：生成一张 `300×700` 的参考图，
把 `auto` / 透传具体比 / 省略三条路各发一次，谁最接近 `0.4286` 就用谁。
（探针 ⑥ 只能静态提示，这轮线上验证省不掉 —— 七牛、aicost、change2pro 三次都是这么定下来的。）

**两种 body 形态的具体写法：**

1. **上游吃像素尺寸**（`size: "WxH"` 字符串，如 aicost gpt-image-2）—— 标准比查表出像素，**非标准比给 `auto`**。
   引擎没有 `if`，所以用「**空 key 当开关**」：`lookup` 的 `fallback` 给空串 → `$keyValue` 的 key 为空 → 返回 `UNDEFINED` → `$coalesce` 切到下一分支。这是模板层唯一的条件分支手段：

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
上游若吃 `{width,height}` **对象**（fal 的 gpt-image-2），把 `value` 换成对象即可；
`aw/ah` 的 `fallback` 别给 0 —— 下游有 `divide(aw/mx)`，0 会触发「不能除以 0」。

2. **上游吃枚举**（gemini 系 `imageConfig.aspectRatio` + `imageSize`）—— **比例原样透传**（把就近映射留给上游），**分辨率必须 `upper` 归一 + 白名单**：

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

分辨率是最容易漏的一环：画布发小写 `2k`、上游枚举是大写 `2K`，直接透传 = 用户选 2K 拿到别的档。
`ref` 要指向该协议**真正读的那个键**：aicost 用 `params.image_size`（画布给大写），change2pro 用 `params.resolution`（画布给小写）。

**怎么发现的**：任务库 `request_json.params` 里躺着 `"aspect_ratio": "1055:1491"` 和 `"resolution": "2k"`（一眼看出不是枚举值），
再用产物文件的 PNG 头部量出实际像素 —— 早期自动档出的是 `1055×1491`（跟随原图），出问题的那批全是 `2880×2880`。
最后用 ⑥ `probe-ratio.mjs` 固化成回归检查：改前 37 项 FAIL，改后 0 项。

---

### 5.6 图片语义：参考图 vs 首帧（「结果没遵循参考图」的根因）

同一组 `images`，写成**裸 URL 字符串**还是**带 `type` 的对象**，上游行为可能完全不同。这不是参数错配，而是**语义选择** —— 动手前必须先看上游文档里「图生视频」那一节的示例怎么写的：

| 上游写法 | 语义 | 约束强度 |
| --- | --- | --- |
| `"images": ["https://…/a.png"]` | 参考图 | **弱** —— 模型只"参考"，不保证构图/人物一致 |
| `"images": [{ "url": "…", "type": "first_frame" }]` | **图生视频首帧** | **强** —— 视频从这张图起帧 |
| 再加一项 `{ "type": "end_frame" }` | 首尾帧 | 强 |

#### 实例（佳速，2026-09-13）

用户反馈「生成成功了，但**没有遵循参考图**」。查 `创建视频(推荐).md`，文档原文：

```yaml
images:
  description: |-
    图片素材列表。每项可以是 URL 字符串，或对象 {url, name?, type?}。
    - 不传 type：作为参考图
    - type=first_frame：图生视频首帧；可再配合 type=end_frame 做首尾帧
```

而且文档里**官方的 `i2v`（图生视频）示例本身就是 `type: first_frame`**。原协议下发的是 `{{inputs.images[*].url}}`（裸 URL 数组）→ 所有 i2v 都被上游当"参考图"处理 → 用户看到「不遵循参考图」。**协议这侧确实有实质缺陷，根因在这里。**

#### 为什么不能直接透传 `role`

DX OS 确实会在素材上带 `role`（类型定义 `StandardProtocolAsset.role`，`declarativeRouter.ts:155-171` 逐条保留），模板里 `{{item.role}}` 是可用的。但 DX OS 给的取值是 `reference_image` / `first_frame` / `last_frame`（`index.ts:3248-3252`）：

- **单图 i2v 永远只给 `reference_image`，从不给 `first_frame`**；
- 只有「mode=i2v ＋ ≥2 张图 ＋ 画布开关选『首尾帧』」时才给 `first_frame`/`last_frame`，且此时 intent 变成 `video.first_last_frame`。

而多数上游的 `type` 枚举**不含 `reference_image`**（佳速只有 `first_frame|end_frame|last_frame`，**不传才是参考图**）。模板层又**没有 lookup**（只有 `$coalesce / $keyValue / $map / $cardinality / $merge`），没法把 `reference_image` 映射成"省略该字段"。

**所以唯一正确的解法是按 intent 拆 operation**（一个 operation 的模板对全部 workflow 生效，没法按 intent 分支）：

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

#### 三个配套点

1. 想让画布的「首尾帧」开关可用，`video.first_last_frame` 必须**同时**出现在**四处**：协议级 `capabilities`、档案 `capabilities`、协议级 `workflows`、档案 `workflows`。缺任一处都会报「模型协议没有匹配 video.first_last_frame 的 workflow」。
2. 画布的「智能多参 / 首尾帧」开关（参数名 `video_reference_mode`）会被 `index.ts:3127` 从转发参数里**删掉**，协议**看不到它** —— 别指望用它做判断。
3. **别一刀切**：上游文档示例若本来就是裸 URL 就**不要**加 `type`。例如 aicost `seedance.md` §4.2「图片参考生成视频」的示例即 `"images": ["https://example.com/reference-1.jpg"]`（它的首尾帧是 MiniMax H3 专属的 `start_frame`/`end_frame`，由另一个 operation 处理）→ **已核查，无需改动**。判断依据只有上游文档，不是"别的站加了我也加"。

---

### 5.7 「多参考也没遵循参考图」≠ `type` 写错（归因纠偏，2026-09-13）

⚠️ **别一看到「没遵循参考图」就改 `type`。** 这四个字至少有两种完全不同的成因，改错方向就是白改一遍。

**先做判别，再动手：**

| 症状 | 先查什么 | 结论 |
| --- | --- | --- |
| **单图** i2v，结果只是"参考得不像" | 上游文档的 i2v 示例用的是裸 URL 还是 `type:first_frame` | 用了裸 URL → **真的是 5.6 的 type 问题** |
| **多图**（≥2 张，多参考）结果完全不像 | ① body 里 `images` 数组顺序 ② prompt 里 `@图片N` 与实际图片的对应 ③ **prompt 正文的场景/服装/风格描写是否与参考图一致** | ① ② 都对之后，**绝大多数是 prompt 与参考图内容冲突** |
| 任何情况 | 参考图 URL 是否公网可达（`curl -I` 看 200） | 本地能取到 ≠ 上游能取到；实测 200 才能排除"图没送到" |

#### 实测案例（佳速 2 图多参考，`gen-1789313483923-0.mp4`）

用户报「传了 2 张图多参考，也没有遵循参考图生成」。逐层取证：

| 检查项 | 实测结果 |
| --- | --- |
| body 里 `images` 形态 | **两个裸 URL 字符串**（多参考本就该裸 URL → **类型语义正确**） |
| 上游自动命名 | 按数组顺序：`图片1` = 黑袍男主、`图片2` = 粉裙女 |
| prompt 引用 | `姜离@图片2` / `顾廷辞@图片1` → **角色与图片一一对应，没有错位** |
| 参考图可达性 | 两条 URL 实测 **HTTP 200 / image/png** |
| 产物 | 1280×720 / 15.1s **现代职场实拍**（西装、茶水间、饮水机、玻璃幕墙） |
| 参考图 | **古风汉服立绘**（黑衣男主 + 粉裙女主） |

→ **协议侧一切都对；根因是 prompt 正文（现代职场）与参考图（古风汉服）内容冲突，模型以文本为准、牺牲了参考图。**

#### 处置（用法侧，不是协议侧）

1. **让 prompt 与参考图同源**：参考图是古装就别写现代职场；要现代职场就换参考图。
2. **多图人物一致性改用 `seedance-2.5` 系**：官方「全能多参 + `@名称`」的示例全部基于 `seedance-2.5-301010`，2.0 系对多参考的遵循度本就有限。
3. **一镜一次生成**：14 秒 3 分镜 + 台词 + 音效塞进单次生成，遵循度必然下降，拆开更稳。

#### 配套硬约束：首帧/尾帧时**不能**下发 `audios`

官方文档明示（佳速 `佳速api开发文档.md`）：

> 使用 first_frame / end_frame 时不要同时传 audios

所以 **`submit.video.first_frame` / `submit.video.first_last` 的 `bodyTemplate` 里不要写 `audios`**，把 `audios` 只留给 `submit.video`（`multi_reference` / `video_to_video` / `audio_reference` 用）。

`omitEmpty: true` **不会**帮你兜住 —— 只要用户挂了音频，`audios` 就会被下发。校验法：给每个 intent 各灌一条「带图片 + 带音频」的探针任务，编译后看 body：

```text
video.image_to_video    → body 里应【无】audios
video.first_last_frame  → body 里应【无】audios
video.multi_reference   → body 里应【有】audios
video.audio_reference   → body 里应【有】audios
```

实测（佳速 v3）：`image_to_video` 的 body =
`{"…","images":[{"url":"…","type":"first_frame"}],"videos":[…]}`
（`audios` 已消失）；`multi_reference` 仍保留 `"audios":[…]`。

---

## 六、写入与生效（必须按顺序）

1. **必须先退出 DX OS**（Electron 主进程不吃优雅关闭）：
   ```bash
   MSYS_NO_PATHCONV=1 taskkill /F /IM "DX OS.exe"
   ```
   （不加 `MSYS_NO_PATHCONV` 会把 `/IM` 当路径；不加 `/F` 对 Electron 主进程无效。）
2. 备份 → 往 `data/custom-protocols-v2.json` 写新协议（`provider` / `model` 两个桶各自独立）。版本条目形如 `{ "version": N, "hash": "<sha256>", "createdAt": "...", "protocol": {...} }`，并设置 `activeVersion`。
   - ⚠️ **`hash` 必须正确**，对不上就静默丢弃整个版本。用 `protocol-hash.mjs` 先核对。
   - ⚠️ **算 hash 只能用 Node**：官方 `canonical()` 的对象键排序用的是 JS `localeCompare`（`repository.ts:37`），与 Python `sorted()` / 其他语言的字典序**不等价**。用别的方式算出来的 hash 会被 `parseEntry` 静默丢弃，表现为「导入成功但版本没出现」。
   - ⚠️ **别用版本号判断修复是否生效**：`custom-protocols-v2.json` 顶层是 `{format, provider, model}`，条目形如 `{id, kind, activeVersion, versions}`，`versions[key].protocol` 才是协议本体。实测 DX OS 0.3.5 会把仓库归一成**单个 active 版本槽**——手写 `versions["2"] + activeVersion = 2` 之后可能落库变成 `versions["1"] + activeVersion = 1`。**认 hash**：任务行的 `model_protocol_hash` 与仓库 active 版本的 hash 一致，才是同一份协议。
   - 写出格式保持 `JSON.stringify(store, null, 2) + "\n"`。
   - 已存在同 hash 版本时只把它设为 active，否则版本号 = 现有最大值 + 1。
3. 配 `data/providers.json`（**是数组，不是对象**）：站点 `protocol` = 平台协议 id、`api_key` = 用户自己的令牌；每个模型 `protocol` 必须指向**模型协议 id**、`caps` 填能力类型。
4. **重启 DX OS** → 模型状态应 `ready`、覆盖率 100%。
   - `repository.ts` 的 `ensureLoaded()` **只读一次并缓存**（第 71-73 行），改完协议必须重启；而 `providers.json` 每次都重读，可以热改。
5. 画布上新建节点逐个模型切换，确认工具条每一格都在、值正确。
6. 真跑一条最短任务（最小参数）确认端到端可用。

---

## 七、排查线上失败：读任务库

DX OS 把每次协议任务的**真实请求体 + 编译后的执行计划**存进 SQLite：

| 项 | 位置 |
| --- | --- |
| 数据库 | `data/protocol-tasks.db` |
| 表 | `ai_protocol_tasks` |
| 关键列 | `request_json` / `plan_json` / `error_message` / `status` / `workflow_state_json` / `remote_task_id` / `poll_attempt` / `model_protocol_hash` / `next_poll_at` / `canvas_id` |
| 事件流表 | `ai_protocol_task_events`（`task_id` / `sequence` / `type` / `data_json` / `created_at`）—— 按 `sequence` 排序即完整时间线，**看轮询节奏和真实终态要用它** |

`plan_json` 里的 `steps[].request.body` 就是真正发出去的 body —— **定位"UI 到底传了什么"最快的路径**。

用托管 Python 读取：
```
C:/Users/<用户名>/.workbuddy/binaries/python/versions/3.13.12/python.exe
```

> ⚠️ **必须把 `db` + `-wal` + `-shm` 三个文件一起复制出来再打开。** 这个库是 WAL 模式且 WAL 可达 20 MB，最新几十条任务全在 WAL 里；用 `?immutable=1`（或只复制 `.db`）会跳过 WAL 读到**过期快照**，症状是"数据库里查不到刚才那条报错"，很容易误判成"任务没入库"。

### 判据：这是协议问题，还是上游问题？

拿到报错先别改协议，按这两步定性：

1. **把 `plan_json` 的 body 与接入文档的请求示例逐字段对比**（字段名、嵌套层级、必填项、大小写）。
2. **看错误信封的 `type`**：中转站自己的校验/鉴权层报 `new_api_error`（如 `Invalid token`）；带 `upstream_error` 且 5xx 的，是**上游/渠道层**的错，与协议无关。

再加一条横向对照：**同一 key、同一站点下其他模型能跑通，就说明鉴权与网络没问题**，剩下的只可能是该模型的渠道。

真实案例（aicost gemini 图片 503）：

- 报错 `503 {"error":{"message":"10k pool upstream unavailable","type":"upstream_error","param":"","code":503}}`
- 同站 `gpt-image-2` 链路正常；两个 gemini 图片模型**同样 503**
- 而 plan body 与文档示例**逐字一致**，参考图也确实内联成了 9 万字符 base64
- → 结论：**aicost 侧 gemini 渠道池不可用，协议一个字都不用改**。正确处理是等渠道恢复或换站点（七牛已有可用的 gemini 链路），不是改协议。

> 顺手核对轮询：`remote_task_id` 为空 + `poll_attempt = 0` 表示没进过轮询。若上游是同步返回（如 aicost `/v1/images/edits` 直接回 `data[].url` / `b64_json`），plan 里带未解析 capture 的 `poll` 步骤不会被执行，因此不报错——但这是**隐患**：一旦上游改为异步返回 `task_id`，轮询就会失败。

### 「上游成功了，DX OS 却显示失败」——先怀疑轮询被瞬时错误判死

最高发的用户投诉句式：**「生成成功了 / 后台能看到成片，但 DX OS 显示失败」**。判据全在任务库里，一眼可辨：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `remote_task_id` | 非空 | **提交成功**，上游确实接了单（上游后台自然能看到任务/成片） |
| `poll_attempt` | 很大（几十~几百） | 轮询跑过很久，不是一开始就错 |
| `error_message` | `fetch failed` | **本地到上游的网络请求抛异常**，不是上游返回的错误信封 |
| `status` | `failed` | 在轮询中途被判死 |

配套再看 `ai_protocol_task_events`（按 `sequence` 排序）：大量 `progress` 事件状态停在 `queued` / `in_progress` 且 progress 不涨，最后一条是 `failed{message:"fetch failed"}` —— 就是典型形态。

**根因（三层串起来才是完整链条）**：

1. `protocol-engine/workflow.ts:519` `resumeProtocolPlan` 里的轮询请求**不区分错误类型**，`executeRequest` 抛出的任何异常都直接冒泡；而 `workflow.ts:253` 只在 `retry.retryNetwork === true` 时重试，协议不写 `retry` 时 `totalAttempts = 1` → **一次瞬时网络抖动 = 轮询函数抛错**。
2. `ai-tasks/service.ts:214-221` 的 catch **一律**把任务写成终态 `failed`，可恢复的 `pending` 任务就此消失。
3. `ai-tasks/store.ts:157-162` 转入终态时**主动擦除** `request_json` / `plan_json` / `workflow_state_json`，并置 `next_poll_at = NULL` → `listDueAiProtocolTasks`（`store.ts:146`，条件 `status='pending' AND next_poll_at IS NOT NULL`）**永远扫不到它**。

**这跟引擎自己的设计直接矛盾**：`server/index.ts:8830-8869` 每 5 秒跑一次 `recoverDueProtocolTasks()` 恢复到期任务，说明「可恢复轮询」本来就是设计目标，却因为第 2 步的错误分类被架空。

> **协议作者能做的只有「加大重试窗口」**（`retry.attempts` 上限 10，见 `validator.ts`）：例如 `{attempts:7, delayMs:3000, backoff:2}` ≈ 硬扛 **189 秒**网络中断，超出就照样判死。**根治必须靠引擎修复**——完整定位（精确到文件:行号）、复现步骤与 P0→P2 补丁建议见工作区根目录 `DX OS 协议引擎缺陷-修复建议.md`。
>
> ⚠️ **别给 `submit` 加 `retryNetwork`**：POST 重试可能重复建单（首个请求已落地但响应丢失），属真实资损风险。只有幂等 GET（`query`）才适合重试。
>
> ⚠️ **轮询 `poll` 也别只写 `intervalMs`**：要同时配 `backoff` / `maxIntervalMs` / `maxDurationMs`。只写 `intervalMs` 时上限会回落到默认 **30 分钟**——而视频任务光排队就常 20~40 分钟，非常危险。

### 更正：失败任务的 `request_json` / `plan_json` 是被主动擦掉的

旧版本文档写过「`plan_json` 有时为空」，**不准确**。实测同一台机器上：

| status | `request_json` | `plan_json` | `workflow_state_json` | `next_poll_at` |
| --- | --- | --- | --- | --- |
| `pending` | 2107 B | 3037 B | 220 B | 有值 |
| `failed` | **2 B（`{}`）** | **2 B（`{}`）** | **NULL** | **NULL** |

即 `store.ts:157-162` 的「毁尸」行为**每次终态化都会发生，不是偶发**。后果是**一出问题就再也无法从任务库取证**。

所以硬规则是：**先查任务库；发现是空串，说明任务已经 failed，只能去画布库 `ccs.db` 找**。

### 「怎么证明参数/prompt 到底有没有发出去」（用户最常问）

不要在对话里靠推断回答，直接读**已落库的编译结果**——`plan_json` 就是最终要发的 plan：

```js
// 任务库复制三件套后（.db / -wal / -shm 必须一起）
const d = db.prepare("SELECT * FROM ai_protocol_tasks WHERE id=?").get(taskId)
const plan = JSON.parse(d.plan_json)          // format: dx-protocol-plan/v1
const submit = plan.steps.find(s => s.id === 'submit')
submit.request.body.prompt                    // ← 真正发出去的 prompt（与画布原文逐字节比对）
submit.request.retry                          // ← 证明 retry 修好没有
plan.steps.find(s => s.id === 'poll').repeat  // ← 证明 backoff / maxDurationMs 生效没有
```

这份 plan 比画布库更权威：画布存的是**提交前**的请求，plan 存的是**编译后**、`{{prompt}}` 已代入的最终形态。

**任务已经 `failed` 时，改用画布库做「保真度 diff」**（`plan_json` 已被擦）。同一个视频卡里同时存着两份文本，直接逐字符比：

```python
card = next(c for c in doc["cards"] if c.get("appId") == "canvas.generate.video")
editor = card["params"]["prompt"]                                        # 编辑器原文
sent   = card["params"]["protocolParams"]["generationRequest"]["prompt"] # 实际提交
difflib.SequenceMatcher(None, editor, sent).get_opcodes()                # 只该有 2 处差异
```

**实测的正常差异只有两处，都属于预期归一，不是丢内容**：

1. 引用标记 `@图[N]`（画布编辑器内部 token）→ `@图片N`（接口要求的引用名）。这恰好命中「不传 `name` 时素材自动命名为 `图片N`」的约定，所以是**对的**，不要在协议里再画蛇添足去解析 `@图[N]`。
2. 末尾多余空行被裁掉。

除这两处外应逐字节相同。若出现截断 / 转义损坏 / 字段丢失，那才是真问题。

> ⚠️ **用户说「后台已失败但界面还在生成中」时，先别当卡死**。画布上那个 `生成中 30:04` 是**前端本地计时器**，要等轮询回写终态才停。
>
> 判据：看 `ai_protocol_task_events` 里轮询是否连续（按 `sequence` 排序算相邻间隔）。实测每 15 s 一次、零断档，仍可能比上游自己看板的「完成时间」晚约 5 分钟——那是**上游两个接口口径不一致**（列表接口说已完成、状态接口还在 `in_progress`），会自行收敛，不是 DX OS 卡死。

---

## 八、已接入站点与合法取值集合

### 图片档案（2026-09-11 实测）

| 站点 / 模型 | aspect_ratio 枚举 | 分辨率字段 | 非标准比归宿（实测成图） |
| --- | --- | --- | --- |
| `七牛` / `gpt-image-2` | 10 个（含 `21:9` `5:4` `4:5`） | `1K` `2K` `4K` | 标准比查像素表；非标准比让 `image_size` 消失 → 上游 `auto` |
| `七牛` / gemini pro·flash | 11 个（含 `9:21`） | `1K` `2K` `4K` | 白名单归一 → `auto`（该上游 `auto` 实测生效） |
| `aicost` / `gpt-image-2` | 7 个 | `image_size` 大写 | **`size:"auto"` → 822×1913（0.4297）精确跟随原图** |
| `aicost` / gemini pro·flash | 7 个 | `image_size` 大写 | 原样透传（上游就近映射） |
| `change2pro` / banana | 10 个 | `resolution`，**上游必须大写** | 原样透传（3:7 → 768×1376 = 9:16） |

> ⚠️ `change2pro` 是唯一一个**画布传小写、上游要大写**的站点；`resolution` 不做 `upper` 归一会让 1K/2K/4K 全部静默失效（见 5.5）。

### 视频档案（这些才需要 duration 兜底）

| 站点 / 模型 | resolution | ratio | duration | 兜底状态 |
| --- | --- | --- | --- | --- |
| `MegabyAI` | `480p` `720p` | `16:9` `9:16` `1:1` | 4–15 | ✅ 已加 |
| `aicost` / `minimax-h3`·`hailuo-03` | 只 `1440P` | `21:9` `16:9` `4:3` `1:1` `3:4` `9:16` | 5–15 | ✅ 已加 |
| `aicost` / `seedance2.5` | `720p` `1080p` `1k` `2k` | `16:9` `9:16` `1:1` | 1–30 | ✅ 已加 |
| `aicost` / `seedance2.0` | `480p` `720p` `1080p` | `16:9` `9:16` `1:1` | 1–30 | ✅ 已加 |
| `佳速 jiasu` | `720p` `1080p` | `16:9` `9:16` `1:1` | 1–30（文档未给范围，按画布档位补 min/max） | ✅ 已加 |
| `sudashuiapi` | **不发该字段**（由模型名决定） | `1:1` `3:4` `4:3` `9:16` `16:9` `21:9` `adaptive` | 4–15 | ✅ 已加 |

> `aicost` 的 `seedance2.0` 与 `seedance2.5` 合法集合互斥，已拆成 `submit.video.seedance25` / `submit.video.seedance20` 两个 operation，通用 workflow 按后缀各复制一份，两个档案的 `workflows` 分别指过去。

> **佳速补充（2026-09-13 依据权威文档 `佳速api开发文档.md` 复核）**：
> - 提交 `POST /v1/video/generations`（`model`+`prompt` 必填）；查询推荐 `GET /v1/videos/tasks/{task_id}`，完成后取 `result_urls`（CDN），状态 `queued|in_progress|completed|failed|unknown`。
> - 素材语义：`images` 每项可为裸 URL 或 `{url,name?,type?}`；**不传 `type` = 参考图**，`type=first_frame` = 图生视频首帧，`first_frame`+`end_frame` = 首尾帧；另有 `materials[{type,url,name?}]` 统一列表（本协议未用）。
> - **引用对齐**：`prompt` 用 `@图片N`（不传 `name` 则按数组顺序自动命名）；传了 `name` 则用 `@name`。DX OS 提交前会把画布 token `@图[N]` 归一为 `@图片N`，**恰好命中自动命名规则** → 本协议一律发裸 URL、**不要补 `name`**（补了反而让 `@图片N` 失配）。
> - **引用规范来源**：`创建视频(推荐).md`、`佳速api开发文档.md`、`查询视频(推荐).md`、`获取模型列表.md`。
> - ⚠️ **过真人（`/v1/face-style`）已整块移除**（2026-09-14，见追加⑤）：`capabilities` 去 `image.edit`、删 `face-style` operation、删 `image.edit` workflow、删 `jiasu-face-style` 档案与 uiSchema、`jiasu-video` 去 `face` 字段。原 `过真人接口（免费）.md` 文档仍在 `佳速api文档/`（仅作历史资料，协议已不再引用），本协议只做视频生成。

**协议文件位置**：`<项目根>/<站点目录>/`（站点目录名如 `佳速api文档`、`七牛`…，项目根位置随意）

---

## 九、验证记录（2026-09-11 起，最新见本节末尾「追加⑥」）

| 验证项 | 结果 |
| --- | --- |
| 六站点 schema 校验 | 全部通过 |
| 六站点编译压测 | **1359 组，0 失败**（2026-09-14 复核，因佳速过真人移除后为 **1372 组，0 失败**） |
| 参数取值白名单断言 | **12615 项检查，0 越界** |
| 断言器对照测试 | 用改动前备份跑，报出 `resolution=4k/1k/2k/480p`、`ratio=9:21/keep_ratio/adaptive/2:3/3:2/source`、`seconds=3/20/25/30` 等真实越界，证明断言器有效 |
| hash 工具 | 对真实仓库体检 **8/8 版本 hash 一致**，算法与官方实现逐字节复现 |
| 六站点语义体检 | 初版 **0 报错级问题**（12 文件 / 6 组配对 / 46 workflow / 32 operation / 90 条素材链路）。**2026-09-14 复核：33 operation / 91 条素材链路，报 23 条，全部为「素材模式 = `public_url`」提示级（MegabyAI 3 / aicost 9 / sudashuiapi 4 / 佳速 7），无报错级** —— 结论见 5.3.1，用户走 URL 方式时这是正确声明，可维持不改 |
| 体检器对照测试 | 往副本注入空方括号 selector、`$cardinality` 缺 `one`、档案级 `uiSchemas` 写字典、幽灵 operation、点号通配模板等，**全部被抓出**，证明规则有效 |
| 打包自包含性 | 解压到临时目录后用副本跑通全部脚本，无遗漏依赖 |

### 2026-09-11 追加：七牛本地图片 409 的定位与修复

| 验证项 | 结果 |
| --- | --- |
| 七牛改后 schema + 编译 | 74 组，**0 失败** |
| 七牛路由探针（改前） | `probe-local-input.mjs` → **3/6 失败**（三个档案的 `image.edit` 都是 `unsupported_local_input`） |
| 七牛路由探针（改后） | **6/6 通过**，`image_urls` 里带 `data:image/png;base64,…` |
| 上游实测 | `POST /queue/openai/gpt-image-2/edit` + Data URL → 200 IN_QUEUE → **COMPLETED**（拿到结果图直链） |
| 仓库 hash 体检 | 8/8 一致 |
| 全站语义体检（新规则后） | 七牛 **0 问题**；**另有 20 条**命中 MegabyAI / aicost / sudashuiapi / 佳速 的 `public_url` 素材链路（2026-09-11 复核：结论见 5.3.1 —— 用户走 URL 方式时这是正确声明，可维持不改） |

### 2026-09-11 追加②：七牛「原图比例」出正方形的定位与修复

| 验证项 | 结果 |
| --- | --- |
| 任务库取证 | `request_json.params` 里实测到 `"aspect_ratio": "1055:1491"` + `"resolution": "2k"`（都不是协议枚举值） |
| 产物取证 | 出问题的成图 PNG 头部全是 `2880×2880`；更早走自动档的那批是 `1055×1491`（跟随原图）→ 反证"跟随原图"本来是可行的 |
| 尺寸矩阵探针（改前） | `probe-ratio.mjs` → **37 项 FAIL**（gpt 非标准比回落 + 分辨率失效；两个 gemini 档案直传枚举外值） |
| 尺寸矩阵探针（改后） | **0 项 FAIL**，36 组全部随用户选择正确变化 |
| 七牛改后 schema + 编译 | 74 组，**0 失败** |
| 七牛路由探针（改后） | 6/6 通过（未回归） |
| 全站尺寸矩阵扫描 | 顺带定位到 aicost（3 个图片档案）与 change2pro（banana）存在同类问题 → 已在下一条中修复 |

### 2026-09-11 追加③：aicost / change2pro 图片尺寸参数修复（同样方式）

| 验证项 | 结果 |
| --- | --- |
| 任务库取证 | aicost `aicost-image-gpt` 那次实测 `"aspect_ratio": "1055:1491"` + `"image_size": "2K"` → 与七牛同款 |
| 尺寸矩阵探针（改前） | aicost **10 项 FAIL**（gpt 非标准比回落成 1024×1024；两个 gemini 档案原样透传枚举外值）；change2pro **18 项 FAIL**（`imageSize` 小写 `1k/2k` 直传 + 比例透传枚举外值） |
| 上游实测：`size:"auto"` | aicost gpt edit + 300×700 参考图 → **822×1913（0.4297）精确跟随原图** ✅ 采用 |
| 上游实测：省略 `aspectRatio` | change2pro → **1024×1024（1:1）**，等于没选 ❌ 弃用 |
| 上游实测：`aspectRatio:"auto"` | change2pro → **1024×1024（1:1）**，`auto` 非合法值被忽略 ❌ 弃用 |
| 上游实测：透传具体比 | change2pro 传 `3:7` → **768×1376（0.5581 = 9:16）**，上游就近映射 ✅ 采用 |
| 最终改法 | aicost gpt：非标准比 → `size:"auto"`；aicost gemini + change2pro：比例**原样透传**，只补 `resolution` 的 `upper` 归一（change2pro 原来选 1K/2K/4K 全部失效） |
| 尺寸矩阵探针（改后） | aicost 36 组 0 FAIL（8 条提示）、change2pro 14 组 0 FAIL（4 条提示） |
| schema + 编译 | aicost 374 组 / change2pro 74 组，**0 失败** |
| 全站四关 | 断言 12615 项 0 越界；仓库 hash 8/8；语义体检仅剩上轮 20 条 `public_url` 视频隐患 |
| 探针升级 | `probe-ratio.mjs` 兼容三种 body 形态，新增 E 项（非标准比透传 = 提示而非报错），并明确"静态推断后必须线上实测一次" |

### 2026-09-13 追加：佳速参数面板整块不显示 + 技能脚本链路修复

| 验证项 | 结果 |
| --- | --- |
| 现象 | 画布选佳速 `seedance-2.0-*` 时，工时长/比例/分辨率**一格都不显示**，只剩「智能多参 / 首尾帧」两个固定 chip |
| 根因定位 | 用 DX OS 官方运行时（`runtime-0.3.5` 的 `protocolManifest.ts`）真机解析确认：档案 `match` 只写了 `seedance-2.5-101010 / seedance-2.5 / kling-v1 / kling`，站点里挂的 `seedance-2.0-933 / -900` **前缀匹配不上** → `resolveProtocolModelProfile().profileId` 为 null → `resolveUiSchema()` 返回 null（`uiSchemas` 里没有 `submit.video` 键）→ `resolveParameterSchema()` 返回 **null** → 工具条整块不渲染 |
| 为什么没早发现 | 全程**零报错**：schema 校验通过、编译 287 组全过、覆盖率 100%、执行模拟全过 |
| 修复（`佳速api文档/jiasu.model.json`） | ① `match` 补 `seedance-2.0-933` / `seedance-2.0`（前缀覆盖 `-900`）；② `duration` 补 `min:1 / max:30`（原来无范围，画布会列 1~60 共 60 项）；③ Profile `limits` 补 `duration` 范围 |
| 参数面板探针（改前） | `probe-panel.mjs` 对改前的 match 副本 → `[档案未命中] seedance-2.0-933` / `-900`，**exit 1** |
| 参数面板探针（改后） | 5 个站点模型 **0 个解析不出**，`duration/aspect_ratio/resolution` 全为「有」 |
| 写入仓库 | model/jiasuapi 新增 **version 2**（hash 已用 `protocol-hash.mjs --verify-store` 核对一致），`activeVersion=2`；备份 `custom-protocols-v2.json.bak-20260913070717` |
| 未加的两格是**正确的** | 「生成音频」佳速 `/v1/video/generations` 无此字段 → 加了就是假开关，不加；「首尾帧」文档明确"不要传首尾帧字段"、协议未声明 `video.first_last_frame` → 该 chip 是死的 |
| 发现的遗留问题（未改，待用户定） | 佳速 `assets.images.mode = "public_url"`，而用户用的是**本地拖入的图片**。探针实测 `[FAIL] jiasu-face-style / image.edit 本地素材过不了素材规则 → 409 unsupported_local_input`。两条路：**(A)** 图片素材改 `data_url` + body 读 `{{inputs.images[*].dataUrl}}`；**(B)** 保持现状，让用户在输入卡片把素材来源切成「公网 URL / 图床」（见 5.3.1）〔⚠️ `jiasu-face-style` 档案已于 v4 删除，故该 FAIL 记录现只对**视频侧素材**有意义〕 |
| 技能链路修复 | 六个脚本里硬编码 `DXOS-Portable-0.2.0`，DX OS 升到 0.3.3/0.3.5 后**四个校验脚本全部 ERR_MODULE_NOT_FOUND**。新增 `bin/dxos-paths.mjs` 自动探测并改造全部脚本，**不带环境变量即可运行** |
| 新增能力 | `bin/probe-panel.mjs`（第 4 层参数面板逐格探针）。已做对照测试：改前副本 FAIL、改后全绿 |

### 2026-09-13 追加②：佳速异步轮询被瞬时网络抖动误杀 —— 协议侧兜底 + 实跑验证

| 验证项 | 结果 |
| --- | --- |
| 现象 | 用户报「视频**后台生成成功**、DX OS 显示失败，而且没遵循我输入的提示词」 |
| 任务库取证（修复前） | `remote_task_id = task_Yc5kG3…`（**提交成功**）、`poll_attempt = 267`、`error_message = fetch failed`、跨 **26 分钟**；事件流 267 条 `progress` 全部停在 `queued`，最后一条 `failed{message:"fetch failed"}` → 典型**轮询被瞬时错误判死**，与上游无关 |
| 根因定位 | `workflow.ts:519` 轮询异常不分类 + `workflow.ts:253` 不写 `retry` 时 `totalAttempts = 1` + `service.ts:214-221` 一律转终态 + `store.ts:157-162` 擦字段并清 `next_poll_at` → 引擎自带的恢复调度（`index.ts:8830`）被架空 |
| 协议侧修复（`佳速api文档/jiasu.model.json`） | ① `operations.query.retry = {attempts:4, delayMs:800, backoff:2, retryStatus:[429,500,502,503,504], retryNetwork:true}`；② 5 个视频 workflow 的 `poll` 补齐 `backoff:1.25 / maxIntervalMs:15000 / maxDurationMs:3600000`；③ 顺手修掉 `face` 字段**永远**发字符串 `"false"` 的潜在 bug → 改成只在启用时下发（`$merge` + `$coalesce` + `$keyValue` 空 key 当开关）〔⚠️ **该 `face` 字段连同整个过真人功能已在 v4 整块删除**，见追加⑤〕 |
| 故意没加 `submit.retryNetwork` | POST 重试可能造成上游**重复建单**（首个请求已落地但响应丢失），属真实资损风险 —— 只给幂等 GET（`query`）加重试 |
| 写入仓库 | model/jiasuapi 落为 active 版本（hash `b032dcf7…`）；`protocol-hash.mjs --verify-store` → **9/9 版本 hash 一致**；备份 `custom-protocols-v2.json.bak-20260913-160405` |
| 改后四关 | schema 通过；编译 **287 组 0 失败**；断言 **12615 项 0 越界**；语义体检仅剩既有 `public_url` 提示；面板探针 **5/5 模型全解析** |
| **实跑验证（16:08 那次）** | 轮询 **122 次**（修复前 267 次）/ 平均 **14.5 s**（退避 5s→15s 生效）/ 最大 22.8 s / **>30 s 断档 0 次 / 网络错误 0 次**；完整等到上游终态，`error_message` 为**上游原文中文业务错误**（不再是光秃秃的 `fetch failed`） |
| 提示词保真度（画布库逐字符 diff） | 编辑器 **1032** 字（含 `@图[1]`）→ 提交 **1029** 字（含 `@图片1`）；差异**仅两处**：`@图[1]`→`@图片1`、末尾 `\n\n` 被裁。**其余逐字节相同** → 提示词传输无问题，可结案 |
| 该次失败的真实原因 | **上游业务失败**：`queued 0%`（6 min）→ `in_progress 50%`（25 min）→ `failed 100%` + 「内容审核未通过，请修改后重试」，后台费用 **¥0**。**进度到 100% 才被拦 → 是成片被内容审核拦下，不是请求被拒** |
| 顺手证实引擎缺陷是必发生 | 该任务转终态后 `request_json` 2107B→**2B**、`plan_json` 3037B→**2B**、`workflow_state_json`→**NULL**、`next_poll_at`→**NULL**（与第一次完全一致，非偶发） |

### 2026-09-13 追加③：佳速 i2v「结果没遵循参考图」—— 首帧语义缺失

| 验证项 | 结果 |
| --- | --- |
| 现象 | 用户报「`gen-1789313000644-0.mp4` 这个视频生产的结果**没有遵循参考图**」 |
| 产物定位 | 文件名时间戳 `1789313000644` 解码 = **23:23:20**，与 `data/protocol-artifacts/7e5a660e…/1ccc23e2-….bin` 完全对上（MP4，1 020 297 B）；`ai_protocol_artifacts` 表把它连到任务 `9eb7b296`（`completed`、model `seedance-2.5-900`、intent `video.image_to_video`、轮询 224 次、跨 57 分钟） |
| 实际下发内容 | 画布库 `ccs.db` → 画布 `806163cc` 的生成卡 `f50a89e7` / 结果卡 `78c2bdc9`：prompt **1029 字**、`duration:13 / aspect_ratio:16:9 / resolution:720p`、参考图 **1 张**（`8dc80966…png`，1672×941，已上传为 `api.dx-os.com` 公网 temp URL）。**提示词与图片都确实发出去了** |
| **根因** | 协议把 `images` 下发成**裸 URL 数组** → 上游按文档判定为「**参考图**」（弱约束）。佳速文档明写「不传 `type`：作为参考图；`type=first_frame`：图生视频首帧」，且**官方 i2v 示例本身就是 `first_frame`**。所以是**协议侧语义选择错了**，不是传输问题、也不是模型不听话 |
| 为什么不能靠 `role` 兜 | DX OS 对**单图 i2v 只给 `role: reference_image`**（`index.ts:3248-3252`），从不给 `first_frame`；而佳速的 `type` 枚举不含 `reference_image`（不传才是参考图）。模板层又没有 lookup → 无法按 role 条件省略字段 → **只能按 intent 拆 operation** |
| 修复 | 新增 `submit.video.first_frame`（`$map` → `{"url":…,"type":"first_frame"}`）并让 `video.image_to_video` 指向它；顺带补 `video.first_last_frame` → `submit.video.first_last`（透传 `role`），此前用户在画布点「首尾帧」+ 2 图会**必然报错**「没有匹配 video.first_last_frame 的 workflow」 |
| 刻意不动的地方 | `video.multi_reference` / `text_to_video` / `video_to_video` / `audio_reference` 仍走原 `submit.video`（裸 URL）—— 多参考图**不该**带 `first_frame`，否则语义反转 |
| 改后四关 | schema 通过；编译 **337 组 0 失败**；断言 **13050 项 0 越界**（5 模型 × 6 意图）；语义体检仅剩既有 `public_url` 提示；面板探针 **5/5 模型全解析**（新增的 `first_last_frame` 也拿到完整参数面板） |
| 编译实证（六种 intent 逐一打印 body） | i2v → `[{"url":…,"type":"first_frame"}]` ✅；multi_reference → `["…","…"]`（无 type，无回归）✅；first_last → `first_frame` + `last_frame` ✅；text_to_video / video_to_video / audio_reference 均不带 `images` ✅；`omitEmpty` 正确丢弃空数组 ✅ |
| 写入手法（**这次的关键增量**） | 新版本写成「**新增版本槽 2 + activeVersion→2 + 版本槽 1 原样保留**」（1 仍是 hash `b032dcf7…`）。因为续跑任务按**版本号**取协议再比对 hash（`service.ts:187-188`），若覆盖掉旧槽，**正在轮询的 2 条任务会以「固定版本已缺失或哈希不一致」全灭**。`--verify-store` → **9/9 版本 hash 一致**；备份 `custom-protocols-v2.json.bak-20260913-233634` |
| 邻站核查（负结果也有价值） | **aicost 无需改动**：`aicost/seedance.md` §4.2「图片参考生成视频」示例即裸 URL `["…/reference-1.jpg"]`，其首尾帧是 MiniMax H3 专属的 `start_frame`/`end_frame`。MegabyAI / sudashuiapi / change2pro / 七牛 协议未使用 `images` 裸数组 |

### 2026-09-13 追加④：佳速 2 图多参考「也没遵循参考图」—— 查完发现协议没锅，改用例

**背景**：用户补充「`gen-1789313483923-0.mp4` 这个视频人物传了 2 张图多参考，也没有遵循参考图生成」，并提供了新的
`佳速api开发文档.md`（43 KB，权威版）要求「遵循这个写 json」。

| 项 | 内容 |
| --- | --- |
| 取证对象 | 任务 `78082d75`，remote `task_nqG3d0xeKqfs1Y4XRYw7fHXrpy4PJLAF`，`intent=video.multi_reference`，模型 `seedance-2.0-900`，跑在协议 **v1**（hash `b032dcf7…`） |
| 实际请求体（编译还原） | `{"model":"seedance-2.0-900","prompt":"…1169 字，含 @图片1/@图片2…","duration":15,"ratio":"16:9","resolution":"720p","images":["…095ccb47…/.png","…6374c191…/.png"]}` |
| 指向核对 | 卡片 `inputs` 顺序 = [黑袍男主.png, 粉裙女.png]；上游自动命名 `图片1`=黑袍男主、`图片2`=粉裙女；prompt 里 `姜离@图片2`、`顾廷辞@图片1` → **一一对应，无错位** |
| 参考图可达性 | 两条 `api.dx-os.com` temp URL 实测 **HTTP 200 / image/png**（24h 有效期） |
| **产物实况** | 抽帧（1/5/9/14s）= **现代职场实拍**：西装男 + 西装女 + 茶水间 + 饮水机 + 百叶窗；参考图是**古风汉服立绘** → **完全没遵循** |
| **根因定性** | **不是协议 bug**。`multi_reference` 用裸 URL 是正确的（裸 URL = 参考图）；引用映射也对。真因是 **prompt 正文（公司茶水间/饮水机/大理石/西裤口袋/玻璃幕墙/高跟鞋）与参考图（古风汉服）内容严重冲突**，模型以文本为主导，牺牲参考图 |
| 次要因素 | ① 官方 `@引用 + name` 的「全能多参」示例全部基于 `seedance-2.5-301010`，2.0 系多参考遵循度有限；② 14 秒 3 分镜 + 台词 + 音效塞单次生成，遵循度必然下降 |
| 按文档做的协议修正（→ **v3**，hash `59137ef5…`） | ① `submit.video.first_frame` / `.first_last` **移除 `audios`**（文档：「使用 first_frame / end_frame 时不要同时传 audios」）；② 重写 `summary` 补齐引用对齐规则与文档出处 |
| 改后四关 | schema 通过；编译 **337 组 0 失败**；`--verify-store` → **10/10 版本 hash 一致**；四个「带图+带音频」探针对照确认 `audios` 只在 `multi_reference`/`audio_reference` 出现 |
| 写入手法 | 追加版本槽 3（保留 1、2），`activeVersion→3`；备份 `custom-protocols-v2.json.bak-20260913-235100-v3pre` |
| 取证产物与复现 | 当次的报告、对比图、一次性脚本**均已清理**（个案已结案，结论全部并入本表 + 5.7 + SKILL.md §5.2.1）。要复现改用**技能内置工具**：`bin/inspect-request-body.mjs` + `references/request-fixture.example.json`（把真实 prompt / 素材 URL 填进同结构的副本即可）。素材原件仍在 `data/blobs/`（`80af7c55` / `787d0d6b` / `8f367793`），抽帧可用 ffmpeg 重跑 |
| 用法侧建议 | ① prompt 与参考图同源；② 多图一致性改用 `seedance-2.5` 系；③ 一镜一次生成；④ 若必须保留古风造型，在 prompt 里显式写「造型严格参考 @图片1/@图片2」 |
| 环境提示 | DX OS 运行时已升到 **0.3.6**，`protocol-engine/*.ts` 用了 TS 参数属性 → 校验脚本须加 `--experimental-transform-types`，否则 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` |

### 2026-09-14 追加⑤：佳速「过真人」功能整块移除（按用户要求 `jiasu.model.json`）

**背景**：用户要求「`jiasu.model.json` 里面关于过真人的功能删掉吧 不需要了」。

| 项 | 内容 |
| --- | --- |
| 移除范围（12 处结构改动） | ① `capabilities` 去 `image.edit`（只剩 6 个视频 intent）；② `summary` 去掉过真人描述；③ 3 个视频 submit（`submit.video` / `.first_frame` / `.first_last`）**解包 `$merge`**——原来套着 `$coalesce/$keyValue` 的 `faceKey` 开关外壳，现已回到扁平 body，并删 `derive.faceKey`；④ 删 `face-style` operation（`POST /v1/face-style`）；⑤ 删 `image.edit` workflow；⑥ 删 `jiasu-face-style` 档案及其 uiSchema；⑦ `jiasu-video.defaults` 去 `face` 字段，uiSchema 字段 4→3 |
| 改后状态 | operations = `submit.video` / `submit.video.first_frame` / `submit.video.first_last` / `query`；workflows = 6 个视频 intent；profiles = 仅 `jiasu-video`；uiSchemas = 仅 `jiasu-video` |
| 残留检查 | `face-style` / `image.edit` / `过真人` / `"face"` / `faceKey` 在源码中 **0 匹配**（先清到只剩 summary 里一句「已移除」说明，再按用户「不需要了」把该说明也删净） |
| 改后编译 | `verify-protocol.mjs` → 第一关 schema 通过；**6 intent × 50 组 = 300 组，编译失败 0 组** |
| 站点侧安全性 | 已核 `data/providers.json`：站点 `佳速SD` 5 个模型 `caps` 全为 `['video']`，**无 `image.edit` 绑定** → 删除该能力不会让任何站点模型失效 |
| 备份 | `jiasu.model.json.bak-20260914-000944-preRemoveFace`（源文件）；写库时另做 `custom-protocols-v2.json` 备份 |
| 文档核对 | 通读权威《佳速api开发文档.md》：**全文无 `/v1/face-style`**（「免费工具」节只有素材上传 `/api/user/media/upload`、`/v1/media/uploads`、`/v1/media/upload`）→ **佐证移除正确**。同轮把 `summary` 从约 600 字压到约 190 字（单段：端点 + 轮询 + 素材语义 + @引用 + audios 互斥），改后编译仍 **300 组 0 失败** |
| 关联清理 | 原 `过真人接口（免费）.md` 文档**仍在工作区**（`佳速api文档/` 下，2026-09-14 复核确认）——协议侧已不再引用它，仅作历史资料保留；如需彻底清理请用户确认后删除。本文档第 974 行引用已同步 |

### 2026-09-14 追加⑥：技能包升级 v3 + 全工具回归（含 4 条用法陷阱补录）

**背景**：用户提供新版 `dxos-protocol-authoring.zip`（含 `dxos-paths` 自动探测、`probe-panel`、`inspect-request-body`）要求更新本地技能。

| 项 | 内容 |
| --- | --- |
| 更新方式 | 先比对：**本地无任何包外独有文件**（包内容严格更新）→ 整包覆盖，再把包里的**他人/占位路径改回本机**（`C:/Users/<用户>/`、`<托管 node>`、`<用户目录>` 共 8 处，涉及 `SKILL.md` / `audit-semantics.mjs` / `param-guards.example.json`） |
| 备份 | `~/.workbuddy/skills/.backup-dxos-20260914-093549`（旧版 9 个文件，可回滚） |
| 文件变化 | 新增 4（`dxos-paths.mjs` / `probe-panel.mjs` / `inspect-request-body.mjs` / `request-fixture.example.json`），更新 8，未变 2（`protocol-hash.mjs` / `onboarding-playbook.md`），合计 13 |
| 引擎探测验证 | `resolveDxosRoot/ServerDir/EngineDir` 自动解析出 `D:\Apps\DXOS-Portable-0.2.0-win-x64` + `runtime-0.3.3-baseline`，与原硬编码 `DEFAULT_ENGINE` **完全一致** → 新版可无缝接替旧版 |
| 全工具回归（7/7 跑通） | ① 六站 **1372 组 0 失败**（佳速 300 / 七牛 74 / aicost 374 / change2pro 74 / sudashuiapi 300 / MegabyAI 250）；② **12615 项 0 越界**；③ `--verify-store` **8 版本 0 不符**；④ 正常输出（23 条全为 `public_url` 提示级，无报错级）；⑤ 七牛 **6/6 链路全接受本地素材**；⑥ 七牛 **36 组全通过**（`source`/`1055:1491` → `auto` 归一正确）；⑦ 佳速 **6 模型全命中档案、0 个解析不出面板** |
| ⑤ 陷阱①：只对图片协议有输出 | 佳速跑 ⑤ / ⑥ 输出 `0 条` / `共 0 组`，一度误判为脚本缺陷。查源码确认：⑤ 内层只遍历 `image.generate` / `image.edit`，⑥ 是图片档案专用 → 纯视频协议必然空结果。**已补进 SKILL.md 与本文档** |
| ⑤ 陷阱②：参数序 | 两个探针是 `<model.json> <provider.json>`（先模型后平台），传反不报错但无输出 |
| ③ 陷阱③：必须 `--verify-store` | 直接传目录报 `EISDIR: illegal operation on a directory, read`；正确用法见 ③ 节 |
| ① 陷阱④：必须 `--experimental-transform-types` | 漏了抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`（要 import 引擎 `.ts`）。本次首轮即踩到，SKILL.md 示例本身写对了，是调用时漏加 |
| 发布整包 | 仓库内 `skills/dxos-protocol-authoring/` 与本地技能目录**逐字节一致**，无历史机器名残留 |

---


## 十、发现的上游（DX OS）问题

### Canvas 面板参数串台（状态隔离 bug）

「API 生成」面板的分辨率等参数状态**在图片页与视频页之间共享**，在图片页选过 `1k` 再切到视频页，请求会带 `invalid_resolution` 的值。

- **实锤证据**：`data/protocol-tasks.db` 中记录 `08:51:46` 请求体 `"resolution":"1k"` → 400 `invalid_resolution`；`08:55:58` 手动改成 `480p` → 请求正常。
- **协议侧只能被动兜底**（见 5.4 节）。
- **建议**：反馈给 DX OS 官方，属于他们 Canvas 应用的状态隔离 bug。

### 协议引擎：异步轮询被一次瞬时网络错误**永久判死**（0.3.5 实测）

这是目前发现的影响面最大的引擎缺陷：**上游任务还在正常跑、后台稍后能出片，DX OS 却已把它标成失败。** 完整链路：

| # | 位置 | 干了什么 |
| --- | --- | --- |
| ① | `protocol-engine/workflow.ts:519` | 轮询请求**不区分错误类型**，`fetch failed` 与 HTTP 400 一样直接冒泡 |
| ② | `ai-tasks/service.ts:214-221` | catch 里**一律**把可恢复的 `pending` 写成终态 `failed` |
| ③ | `ai-tasks/store.ts:157-162` | 转终态时**主动擦除** `plan_json` / `request_json` / checkpoint，并把 `next_poll_at` 置 NULL |

第 ③ 步后果是致命的：后台恢复调度器的扫描条件是 `status='pending' AND next_poll_at IS NOT NULL`（`store.ts:146`），**任务一被标失败就永远扫不到了**。同时 `service.ts:180` 的 `if (task.status !== 'pending') return task` 让失败任务**连手动恢复的机会都没有**。

- **实锤**：佳速那条任务 `remote_task_id` 非空、`poll_attempt = 267`、跑了 26 分钟、`error_message = fetch failed` —— 上游仍在跑，本地误判。
- **另有一处负优化**：终态时擦掉 `request_json`/`plan_json`，而出问题的那一刻恰恰最需要这些信息（本技能第 7 节的排查方法正因此被迫改道画布库）。
- **协议侧只能加大重试窗口**（`attempts` 上限 10，约能硬扛 2~3 分钟网络中断），**根治必须靠引擎修复**。
- **完整根因链（精确到文件:行号）、真实现场数据、5 步复现步骤、P0→P2 补丁建议、涉及文件清单**：见工作区根目录 **`DX OS 协议引擎缺陷-修复建议.md`**，可直接转交开发团队。
- ⚠️ **不要**去本地改 `.dx-runtime/versions/<runtime>/…/app.asar.unpacked/` 里的引擎源码：虽然 `.ts` 是明文可改，但应用一升级整个运行时目录被替换，改动静默消失，还会破坏 hash 体系的可信度。

---

## 十一、常见问题速查

| 现象 | 先查什么 |
| --- | --- |
| 导入成功但版本没出现 | `protocol-hash.mjs --verify-store` 核对 hash |
| 装不进去 | `verify-protocol.mjs` 第一关（schema）逐条报错 |
| 协议改了没生效 | 是否重启 DX OS（`ensureLoaded()` 只读一次） |
| 面板少一格 | **先跑 `probe-panel.mjs`**。两种成因：① `uiSchemas` 少了某个 key（四个关键格是 `duration`/`aspect_ratio`/`resolution`/`generate_audio`）；② `modelProfiles[].match` 没覆盖站点真实模型名 |
| 面板一格都不显示 | ① `modelProfiles[].match` 前缀匹配不上站点里的模型名（**最常见**，2026-09-13 佳速实例）；② `uiSchemas` 写成了字段名字典。跑 `probe-panel.mjs` 一眼定位（`[档案未命中]` / `[空的]`） |
| 校验脚本报 `ERR_MODULE_NOT_FOUND` | 脚本里的 DX OS 路径没找到。新版已自动探测；若装在非常规目录，设 `DXOS_ROOT` 指到 `DXOS-Portable-x.y.z-win-x64` 根目录 |
| 报「输出类型 undefined」 | `workflow.result.kind` 是否写了 |
| 报「仍包含未解析的 capture」 | path 占位符键名是否 == 响应捕获键名 |
| 上游 400 `must be an array of strings` | 素材是否误用了裸 `{{inputs.images}}` |
| 上游 400 `invalid_resolution` 等 | 跑 `assert-param-guards.mjs`；大概率是串台 + 缺兜底 |
| 选了「原图比例」却出正方形 | 画布发的是 GCD 约分比（如 `1055:1491`），不是 `source` → `lookup` 落到 fallback=1。跑 `probe-ratio.mjs`；改法见 5.5 |
| 选了 2K 却是别的尺寸 | 画布分辨率是小写 `2k`，协议 `cases` 写的是 `"2K"` → 不命中。跑 `probe-ratio.mjs`；改法见 5.5 |
| 参数看着生效其实没生效 | 一律先跑 `probe-ratio.mjs`（图片档案）——它专抓"不报错但没生效" |
| 非标准比（原图比例）在枚举型上游该怎么处理 | 别猜：用 `300×700` 参考图线上实测 `auto` / 透传 / 省略三条路，谁最接近 `0.4286` 用谁（见 5.5 实测表）。探针的 E 项只是静态提示 |
| 上游 503 + `type: upstream_error` | **不是协议问题**，是该模型的上游渠道不可用。同 key 下其他模型能通即证明鉴权/网络正常；等渠道恢复或换站点 |
| `$dataUrlBase64 必须渲染为 Data URL` | 该档案的 `assets.images.mode` 是否 `data_url` |
| 画布报 `…当前不可执行：unsupported_local_input` | 协议声明了 `public_url`/`remote_name`，但用户走的是**画布 Base64 方式**（素材只有 dataUrl）→ 要么让用户开「素材传输 = URL（图床）」，要么图片改 `data_url` + 读 `{{inputs.images[*].dataUrl}}`；跑 `probe-local-input.mjs` 验证。别信提示里的「兼容模式」 |
| 同一句但 reason 是 `protocol_v2_missing` / `model_profile_missing` | 协议没装进仓库、站点 `models[].protocol` 没指到模型协议、或档案 `match` 匹配不到上游模型名 |
| 本地文件上传后丢失 | 是否误写了 `workflow.steps`（正确是 `uploads`） |
| 具体型号能力/参数全错 | Profile 是否被笼统档前缀抢匹配（顺序问题） |
| 张数上限无效 | `limits.references` 是否嵌套 |
| 说不清的「某功能静默失效」 | 先跑一次 `audit-semantics.mjs` 全扫（键名 / selector / 素材模式 / 引用断链） |
| **「后台生成成功了，DX OS 却显示失败」** | 先怀疑轮询被瞬时错误判死。查任务库四字段：`remote_task_id` **非空**（提交成功）+ `poll_attempt` 很大 + `error_message = "fetch failed"` + `status = failed` → **不是协议问题，是引擎缺陷**（详见第十节）。协议侧只能给 `query` 补 `retry.retryNetwork` |
| 异步任务轮询中途报 `fetch failed` | 该 operation 有没有写 `retry`。**不写时 `attempts` 默认 1、网络错误不重试** → 一次抖动即死。`retry` 必须写在 **operation** 上（`query`），不是 workflow 上；`submit`（POST）**不要**加，避免重复建单 |
| 任务库里 `request_json` / `plan_json` 是 `{}` | **不是"没入库"**，是该任务已转终态被 `store.ts:157-162` 主动擦掉了。改用画布库 `ccs.db` → `canvases.document_json` → `cards[]` 找 `params.protocolParams.generationRequest`；或换一条还没结束的任务去读 `plan_json` |
| 界面一直转「生成中 xx:xx」不结束 | 那是**前端本地计时器**，要等轮询回写终态才停。先看 `ai_protocol_task_events` 里轮询是否连续（相邻 `sequence` 间隔）；若每 15 s 一次、零断档，说明 DX OS 一直在问，是**上游状态接口**还没改口（常见比上游自己的「完成时间」晚几分钟），会自行收敛 |
| 用户问「提示词到底传上去了没有」 | 别靠推断。先读 `plan_json` 的 `steps[].request.body.prompt` 与原文逐字节比；任务已 `failed` 就去画布库做逐字符 diff（`params.prompt` vs `generationRequest.prompt`）。**只该有 2 处差异**：`@图[N]`→`@图片N`、末尾空行 —— 这两处是预期归一，不是丢内容 |
| 算出来的 hash 明明对，导入后版本还是不出现 | 是不是用 Python / 其它语言算的。官方 `canonical()` 用 JS `localeCompare` 排序对象键，与 Python `sorted()` 不等价 → **只能用 Node 算**（`protocol-hash.mjs`） |
| 上游没报错，但结果就是「没按提示词来」 | 先确认成片**真的生成出来了**（有的失败是审核/渠道问题，根本没出片，用户会误判成"没遵循提示词"）。用画布库 diff 确认提示词完整后，再考虑是模型对复合提示词的遵循度问题（多镜 + 台词 + 音效塞进单次生成，遵循度普遍差），建议拆成一镜一次 |
| **生成的视频「没遵循参考图」** | **先分清是「单图」还是「多图」，两者归因完全不同**。① **单图 i2v** → 多为**语义选择**问题：`images` 每项**带不带 `type`** 决定上游按"参考图"（弱）还是"首帧"（强）处理；佳速等上游必须 `type=first_frame` 才是真·图生视频，而 **DX OS 对单图 i2v 只给 `role: reference_image`**，不能透传 → 必须**按 intent 拆 operation** + `$map` 显式构造（改法与三种写法模板见 **5.6**）。② **多图多参考** → 裸 URL 本就是对的，先核 `images` 顺序 / `@图片N` 指向 / 参考图 URL 可达性，再核 **prompt 正文与参考图内容是否冲突**（实测佳速那次就是「prompt 写现代职场、参考图是古风汉服」），协议不用改（见 **5.7**） |
| **「多参考也没遵循参考图」，是不是 `type` 又写错了？** | **不是。** 多参考用裸 URL 是正确的（裸 URL = 参考图）。按 5.7 的三步核：`images` 数组顺序 → `@图片N` 指向 → prompt 与参考图内容一致性。**别把"没遵循"一律归到 `type` 上** |
| **首帧/尾帧任务上游报错、说不能带音频** | 官方文档明示「使用 first_frame / end_frame 时不要同时传 audios」。协议里 `submit.video.first_frame` / `.first_last` 的 `bodyTemplate` **不要写 `audios`**；`omitEmpty: true` 兜不住这个（用户挂了音频就会下发）。校验法与实测见 **5.7** |
| 用户点了画布「首尾帧」+ 2 张图就报错 | 这是**UI 上可点到、但必然报错**的坑：`video.first_last_frame` 没在**四处**同时声明（协议 `capabilities`、档案 `capabilities`、协议 `workflows`、档案 `workflows`）。见 5.6 |
| 换了协议版本后，正在跑的任务全报「固定版本已缺失或哈希不一致」 | 写新版本时**覆盖**了旧版本槽。续跑是**按版本号取协议再比对 hash** → 必须写成「**新增槽 + activeVersion 指过去 + 旧槽原样保留**」（`versions` 本身支持多槽，官方 `saveProtocolV2` 也只新增不裁剪） |

---

## 十二、关键源码位置（想确认什么就去读）

路径：`<最大 runtime>/resources/app.asar.unpacked/server/`

| 想确认什么 | 去读 |
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
| `retry` 有没有被真的用上（`attempts` 默认值、网络错误分支） | `protocol-engine/workflow.ts:237-259` |
| 轮询请求抛异常时怎么处理（**不分类，直接冒泡**） | `protocol-engine/workflow.ts:519` |
| 轮询间隔 / 抖动 / 最长等待 | `protocol-engine/workflow.ts:485 / 508-512 / 531` |
| `retry` 字段的合法范围（`attempts` 1–10、`delayMs` 0–300000、`backoff` 1–10） | `protocol-engine/validator.ts` |
| 异步任务何时被判成终态 `failed` | `ai-tasks/service.ts:214-221`（另 `:180` 的 `status !== 'pending'` 硬门槛） |
| 任务落库、**终态时擦除 `plan_json`/`request_json`** | `ai-tasks/store.ts:152-163`（`listDueAiProtocolTasks` 在 `:146`） |
| 后台每 5 秒恢复到期轮询任务 | `server/index.ts:8830-8869` |
| hash 规范化算法（对象键用 JS `localeCompare` 排序） | `protocol-engine/repository.ts:37`、`parseEntry` 在 `:60` |
| 素材的 `role` 取值从哪来（单图 i2v = `reference_image`） | `server/index.ts:3248-3252`（首尾帧模式才给 `first_frame`/`last_frame`） |
| 画布「智能多参 / 首尾帧」开关为何在协议里看不见 | `server/index.ts:3127` 把 `video_reference_mode` 从转发参数中 **delete** 掉 |
| `role` 会不会传进协议模板 | `ai-tasks/declarativeRouter.ts:155-171`（`...(input.role ? { role: input.role } : {})`，逐条保留） |
| 怎么把 URL 数组构造成 `{url,type}` 对象数组（`$map` / `$cardinality`） | `protocol-engine/compiler.ts:179-209` |
| 协议仓库能存几个版本、写新版会不会覆盖旧槽 | `protocol-engine/repository.ts:144-169`（`saveProtocolV2` 只新增槽、不裁剪） |
| 续跑任务按什么取协议（版本号 → 再比对 hash） | `ai-tasks/service.ts:187-188` |
| 界面工具条逐格渲染逻辑 | `data/developer-apps/.versions/canvas/<ver>/source/assets/index-*.js` |
