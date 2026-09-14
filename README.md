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
└── skills/
    └── <技能名>/                       # 每个技能一个目录，互相独立
        ├── SKILL.md                   # 技能主清单（AI 助手加载的入口）
        ├── README.md                  # 该技能的完整文档
        ├── bin/                       # 可执行脚本
        └── references/                # 参考资料与配置模板
```

**新增技能时**：在 `skills/` 下建一个新目录，放入该技能的 `SKILL.md` / 脚本 / 参考资料，然后在上面的「技能列表」里补一行即可。

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
