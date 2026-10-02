$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Python = Join-Path $Root "api\.venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Host "Run setup-local.ps1 first" -ForegroundColor Red
    exit 1
}
Set-Location $Root
& $Python (Join-Path $PSScriptRoot "init-db.py")
