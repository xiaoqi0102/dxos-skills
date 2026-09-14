# ==========================================================
# 启用仓库自带的 pre-commit 密钥扫描钩子（Windows PowerShell）
# ==========================================================
# 用法（在仓库根目录执行）：
#   powershell -ExecutionPolicy Bypass -File scripts/install-hooks.ps1
#
# 作用：把 hooks/pre-commit 复制到 .git/hooks/pre-commit，
#       使每次 git commit 前自动扫描是否夹带 API Key。
# ==========================================================

$ErrorActionPreference = "Stop"

$repoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
    Write-Error "当前目录不是 git 仓库"
    exit 1
}
$repoRoot = $repoRoot.Trim()

$src = Join-Path $repoRoot "hooks\pre-commit"
$dstDir = Join-Path $repoRoot ".git\hooks"
$dst = Join-Path $dstDir "pre-commit"

if (-not (Test-Path $src)) {
    Write-Error "找不到 $src"
    exit 1
}

New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
Copy-Item -Path $src -Destination $dst -Force

Write-Host "已启用密钥扫描钩子："
Write-Host "  $dst"
Write-Host ""
Write-Host "之后每次 git commit 都会先扫描是否夹带 API Key / 令牌。"
Write-Host "确认误报需要跳过时：`$env:SKIP_SECRET_SCAN=1; git commit ..."
