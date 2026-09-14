# DX OS Skills

> 一套面向 DX OS（本地桌面版）的 AI 助手技能集合，用于把上游 API 接入 DX OS 自定义协议、并在落地前发现并修复各类静默失效问题。

每个技能都是独立可用的，放在 `skills/<技能名>/` 下，可直接复制到 AI 助手的技能目录使用。

---

## 技能列表

| 技能 | 一句话说明 | 文档 |
| --- | --- | --- |
| [dxos-protocol-authoring](skills/dxos-protocol-authoring/) | 编写 / 修复 / 校验 DX OS 自定义协议（`dx-protocol/v2`），含 7 个离线校验与取证工具 | [详细文档](skills/dxos-protocol-authoring/README.md) |

---

## 快速开始

```bash
# 1. 克隆本仓库
git clone https://github.com/xiaoqi0102/dxos-skills.git
cd dxos-skills

# 2. 把需要的技能复制到助手技能目录（可只复制其中一个）
mkdir -p ~/.workbuddy/skills
cp -r skills/dxos-protocol-authoring ~/.workbuddy/skills/

# 3. 按该技能的文档配置运行环境
#    见 skills/dxos-protocol-authoring/README.md「快速开始」
```

> 每个技能目录下都有独立的 `README.md`，包含安装、环境依赖、工具用法与排查手册。
> 根目录这份 README 只做索引，方便快速定位。

---

## 目录约定

```
dxos-skills/
├── README.md                          # 本文件：技能索引
├── .gitignore                         # 密钥类文件防护
├── hooks/pre-commit                   # 提交前密钥内容扫描
├── scripts/                           # 密钥扫描器 + 钩子安装脚本
└── skills/
    └── <技能名>/                       # 每个技能一个目录，互相独立
        ├── SKILL.md                   # 技能主清单（AI 助手加载的入口）
        ├── README.md                  # 该技能的完整文档
        ├── bin/                       # 可执行脚本
        └── references/                # 参考资料与配置模板
```

**新增技能时**：在 `skills/` 下建一个新目录，放入该技能的 `SKILL.md` / 脚本 / 参考资料，然后在上面的「技能列表」里补一行即可。

---

## 密钥安全（重要）

DX OS 协议里通常要填上游 API 的 `apiKey`，**真实密钥绝不能提交进仓库**。本仓库有三道防线：

| 防线 | 位置 | 作用 |
| --- | --- | --- |
| 文件名 | `.gitignore` | 挡住 `.env` / `*.key` / `*.pem` / `*apikey*.json` 等密钥类文件 |
| 文件内容 | `hooks/pre-commit` | 提交前扫描内容，拦住藏在普通文件里的密钥 |
| 手动/CI | `scripts/scan-secrets.mjs` | 随时全仓扫描 |

**克隆后先启用钩子**（`.git/hooks` 不随仓库分发，必须手动装一次）：

```bash
# Git Bash / macOS / Linux
sh scripts/install-hooks.sh

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File scripts/install-hooks.ps1
```

启用后，若提交里夹带疑似密钥会被直接阻断。随时手动体检：

```bash
node scripts/scan-secrets.mjs          # 全仓库
node scripts/scan-secrets.mjs --staged # 只看暂存区
```

写配置模板时，值一律用占位符，例如：

```json
{ "apiKey": "YOUR_API_KEY" }
```

> 注意：钩子只能拦住"还没提交"的密钥。**若密钥已经被提交过哪怕一次，它就已经泄漏到 git 历史里**，必须去服务商后台吊销并重新签发，光删文件是没用的。

---

## 环境要求

本仓库技能主要面向 **Windows + Node.js ≥ 22** 环境，脚本通过 DX OS 运行时自带的 `protocol-engine` 做真机校验。

| 依赖 | 说明 |
| --- | --- |
| Node.js ≥ 22 | 建议用托管版本，脚本校验需要 |
| DX OS 便携版 | 运行时路径由脚本自动探测，装在非常规目录时用 `DXOS_ROOT` 指定 |

具体某个技能的依赖与用法，见该技能自己的 `README.md`。

---

## 许可

本仓库内容供学习与自用。第三方 API 的接入文档、字段约定等版权归各自服务商所有。
