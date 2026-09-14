#!/bin/sh
# ==========================================================
# 启用仓库自带的 pre-commit 密钥扫描钩子
# ==========================================================
# 用法（在仓库根目录执行）：
#   sh scripts/install-hooks.sh
#
# 作用：把 hooks/pre-commit 链接/复制到 .git/hooks/pre-commit，
#       使每次 git commit 前自动扫描是否夹带 API Key。
# ==========================================================

set -u

repo_root=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$repo_root" ]; then
  echo "错误：当前目录不是 git 仓库" >&2
  exit 1
fi

src="$repo_root/hooks/pre-commit"
dst="$repo_root/.git/hooks/pre-commit"

if [ ! -f "$src" ]; then
  echo "错误：找不到 $src" >&2
  exit 1
fi

mkdir -p "$repo_root/.git/hooks"
cp "$src" "$dst"
chmod +x "$dst"

echo "已启用密钥扫描钩子："
echo "  $dst"
echo ""
echo "之后每次 git commit 都会先扫描是否夹带 API Key / 令牌。"
echo "确认误报需要跳过时：SKIP_SECRET_SCAN=1 git commit ..."
