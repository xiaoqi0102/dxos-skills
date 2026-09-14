#!/bin/sh
# ==========================================================
# 统一环境入口（换电脑共享本目录时，无需改任何路径）
# ==========================================================
# 用法（Git Bash）：
#   . "C:/Users/<用户名>/Desktop/新api接口-dxos/dxos-skills/scripts/dx-env.sh"
#   # 之后即可用：
#   "$DX_NODE" "$DX_SKILL/bin/verify-protocol.mjs" provider.json model.json
#
# 作用：自动解析当前机器的用户名 / 主目录 / 技能目录 / Node 路径 /
#       DXOS 安装位置，全部通过环境变量暴露，避免把 Admin / LYQ 写死。
#
# 可用变量（导出前已解析）：
#   DX_USER      当前 Windows 用户名
#   DX_HOME      当前用户主目录
#   DX_SKILLS    技能目录（默认 ~/.workbuddy/skills）
#   DX_SKILL     dxos-protocol-authoring 技能目录
#   DX_BIN       技能 bin 目录
#   DX_NODE      Node 可执行文件
#   DXOS_ROOT    DX OS 便携版根目录（探测失败则为空）
# ==========================================================

# --- 用户名与主目录 ---
if [ -z "${DX_USER:-}" ]; then
  DX_USER="${DXOS_USER:-${USERNAME:-${USER:-}}}"
fi
if [ -z "$DX_USER" ]; then
  DX_USER=$(basename "${DXOS_HOME:-${USERPROFILE:-$HOME}}")
fi

DX_HOME="${DXOS_HOME:-${USERPROFILE:-$HOME}}"
DX_SKILLS="${DXOS_SKILLS_DIR:-$DX_HOME/.workbuddy/skills}"
DX_SKILL="$DX_SKILLS/dxos-protocol-authoring"
DX_BIN="$DX_SKILL/bin"

# --- Node：优先托管版，其次 PATH ---
if [ -z "${DX_NODE:-}" ]; then
  for cand in \
    "$DX_HOME/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" \
    "$DX_HOME/.workbuddy/binaries/node/versions/24.14.0/node.exe"; do
    [ -x "$cand" ] && DX_NODE="$cand" && break
  done
fi
[ -z "$DX_NODE" ] && DX_NODE=$(command -v node 2>/dev/null)

# --- DX OS 根目录：交给 Node 模块统一探测（避免两套逻辑不一致） ---
if [ -z "${DXOS_ROOT:-}" ] && [ -x "$DX_NODE" ] && [ -f "$DX_BIN/dxos-paths.mjs" ]; then
  DXOS_ROOT=$(MSYS_NO_PATHCONV=1 "$DX_NODE" "$DX_BIN/dxos-paths.mjs" 2>/dev/null \
    | sed -n 's/^  DXOS 根目录[[:space:]]*//p')
fi

export DX_USER DX_HOME DX_SKILLS DX_SKILL DX_BIN DX_NODE
[ -n "${DXOS_ROOT:-}" ] && export DXOS_ROOT

# --- 自检输出（静默模式：DX_QUIET=1 时不打印） ---
if [ "${DX_QUIET:-0}" != "1" ]; then
  echo "环境已就绪："
  echo "  用户       $DX_USER"
  echo "  主目录     $DX_HOME"
  echo "  技能目录   $DX_SKILL"
  echo "  Node       ${DX_NODE:-未找到}"
  echo "  DXOS 根目录 ${DXOS_ROOT:-未探测到（可用 DXOS_ROOT 指定）}"
fi
