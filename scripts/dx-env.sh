#!/bin/sh
# ==========================================================
# DX OS Skills — 统一环境入口（自定位，放哪都能用）
# ==========================================================
# 设计原则：所有路径以「运行时实际位置」为准，不假设父目录叫什么，
#           也不假设用户把仓库放在 Desktop 或某个固定目录。
#           仓库可以被克隆到任意位置，例如：
#             D:\dxos-skills
#             E:\work\projects\dxos-skills
#             C:\Users\me\Desktop\some-folder\dxos-skills
#           脚本会从自身位置反推仓库根（$DX_REPO），放哪都对。
#
# 用法（Git Bash）—— source 你自己实际放的那份，从任意目录都行：
#   . "/d/dxos-skills/scripts/dx-env.sh"
#   . "/e/work/dxos-skills/scripts/dx-env.sh"
#   . "/c/Users/me/Desktop/某个目录/dxos-skills/scripts/dx-env.sh"
#   # 之后即可用：
#   "$DX_NODE" "$DX_BIN/verify-protocol.mjs" provider.json model.json
#
# 导出的变量：
#   DX_REPO      本仓库根目录（由脚本自身位置推导，绝对可靠）
#   DX_PROJECT   项目根 = 仓库的父目录（可能不存在，存在时才有意义）
#   DX_USER      当前 Windows 用户名
#   DX_HOME      当前用户主目录
#   DX_SKILLS    技能安装目录（默认 ~/.workbuddy/skills）
#   DX_SKILL     dxos-protocol-authoring 技能目录
#   DX_BIN       技能 bin 目录
#   DX_NODE      Node 可执行文件
#   DXOS_ROOT    DX OS 便携版根目录（探测失败则为空）
#
# 覆盖方式（任选，设了就不自动探测）：
#   DX_REPO / DX_PROJECT / DX_SKILLS / DX_SKILL / DX_NODE / DXOS_ROOT / DX_HOME
# ==========================================================

# --- ① 自定位：从脚本自身位置推导仓库根 ---
# 兼容被 source、被 sh 执行、符号链接、以及 Windows 风格路径（D:/xxx）三种情况。
# 注意：不要用 `cd "$(dirname ...)" && pwd` 求路径 —— 跨盘 Windows 路径下会失败，
#       这里改成纯字符串处理，最稳。
_dx_self="${BASH_SOURCE:-$0}"
# 解析符号链接；readlink 不可用或失败则退回原值
_dx_real=$(readlink -f "$_dx_self" 2>/dev/null)
[ -n "$_dx_real" ] || _dx_real="$_dx_self"
# 反斜杠统一成斜杠（Windows 路径兼容），再去掉末尾斜杠
_dx_real=$(printf '%s' "$_dx_real" | tr '\\' '/')
_dx_real="${_dx_real%/}"

# 逐级向上：去掉文件名 → scripts/，再去掉 scripts → 仓库根
if [ -z "${DX_REPO:-}" ]; then
  DX_REPO="${_dx_real%/*}"      # .../dxos-skills/scripts
  DX_REPO="${DX_REPO%/*}"       # .../dxos-skills
fi

# 项目根 = 仓库的父目录；若仓库直接放在盘符根（如 D:/dxos-skills），
# 父目录只剩盘符（D:）或无意义，此时视为「无项目根」。
if [ -z "${DX_PROJECT:-}" ] && [ -n "$DX_REPO" ]; then
  _dx_parent="${DX_REPO%/*}"
  case "$_dx_parent" in
    "" | "$DX_REPO" | [A-Za-z]: | [A-Za-z]:/) _dx_parent="" ;;
  esac
  [ -n "$_dx_parent" ] && DX_PROJECT="$_dx_parent"
fi

# --- ② 用户名与主目录（不写死任何具体用户名） ---
if [ -z "${DX_USER:-}" ]; then
  DX_USER="${DXOS_USER:-${USERNAME:-${USER:-}}}"
fi
if [ -z "$DX_USER" ]; then
  DX_USER=$(basename "${DXOS_HOME:-${USERPROFILE:-$HOME}}")
fi

DX_HOME="${DXOS_HOME:-${USERPROFILE:-$HOME}}"

# --- ③ 技能目录 ---
# 优先：已在技能目录里跑（DX_SKILLS 显式指定）
# 其次：优先用「仓库内自带的技能」拷过去的安装位置；仓库里的是一等公民
DX_SKILLS="${DXOS_SKILLS_DIR:-$DX_HOME/.workbuddy/skills}"
DX_SKILL="${DX_SKILL:-$DX_SKILLS/dxos-protocol-authoring}"
DX_BIN="$DX_SKILL/bin"

# --- ④ Node：优先托管版（扫描实际存在的版本目录），其次 PATH ---
if [ -z "${DX_NODE:-}" ]; then
  for _base in "$DX_HOME/.workbuddy/binaries/node/versions"; do
    [ -d "$_base" ] || continue
    # 取版本号最大的一个（按字典序足够，形如 22.22.2-3 / 24.14.0）
    for _v in $(ls -1 "$_base" 2>/dev/null | sort -r); do
      if [ -x "$_base/$_v/node.exe" ]; then
        DX_NODE="$_base/$_v/node.exe"
        break
      fi
    done
  done
fi
[ -z "$DX_NODE" ] && DX_NODE=$(command -v node 2>/dev/null)

# --- ⑤ DX OS 根目录：交给 Node 模块统一探测（避免两套逻辑不一致） ---
if [ -z "${DXOS_ROOT:-}" ] && [ -n "$DX_NODE" ] && [ -f "$DX_BIN/dxos-paths.mjs" ]; then
  DXOS_ROOT=$(MSYS_NO_PATHCONV=1 "$DX_NODE" "$DX_BIN/dxos-paths.mjs" 2>/dev/null \
    | sed -n 's/^  DXOS 根目录[[:space:]]*//p')
fi

export DX_REPO DX_PROJECT DX_USER DX_HOME DX_SKILLS DX_SKILL DX_BIN DX_NODE
[ -n "${DXOS_ROOT:-}" ] && export DXOS_ROOT

# --- ⑥ 自检输出（静默模式：DX_QUIET=1 时不打印） ---
if [ "${DX_QUIET:-0}" != "1" ]; then
  echo "环境已就绪："
  echo "  仓库根     ${DX_REPO:-未识别}"
  echo "  项目根     ${DX_PROJECT:-未识别}"
  echo "  用户       $DX_USER"
  echo "  主目录     $DX_HOME"
  echo "  技能目录   $DX_SKILL"
  echo "  Node       ${DX_NODE:-未找到}"
  echo "  DXOS 根目录 ${DXOS_ROOT:-未探测到（可用 DXOS_ROOT 指定）}"
fi

unset _dx_self _dx_real _dx_parent _base _v
