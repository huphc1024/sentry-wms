# One-time local setup (no Docker)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host "=== Sơn Lộc WMS local setup ===" -ForegroundColor Cyan

# Python venv + API deps
$Venv = Join-Path $Root "api\.venv"
if (-not (Test-Path $Venv)) {
    Write-Host "Creating Python venv..." -ForegroundColor Yellow
    python -m venv $Venv
}
Write-Host "Installing Python packages..." -ForegroundColor Yellow
& (Join-Path $Venv "Scripts\pip.exe") install -r (Join-Path $Root "api\requirements.txt") -q

# Admin npm
Write-Host "Installing admin npm packages..." -ForegroundColor Yellow
Push-Location (Join-Path $Root "admin")
npm install --silent
Pop-Location

# .env
& (Join-Path $PSScriptRoot "generate-env.ps1")

Write-Host ""
Write-Host "Done. Next steps:" -ForegroundColor Green
Write-Host "  1. Install PostgreSQL 16 (see docs\local-setup-windows.md)"
Write-Host "  2. Edit .env -> POSTGRES_SUPERUSER_PASSWORD"
Write-Host "  3. .\scripts\init-db.ps1"
Write-Host "  4. .\scripts\start-api.ps1  +  .\scripts\start-admin.ps1"
