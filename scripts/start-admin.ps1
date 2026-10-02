$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location (Join-Path $Root "admin")
$env:VITE_API_PROXY = "http://127.0.0.1:5000"
Write-Host "Starting Admin UI on http://localhost:4000" -ForegroundColor Cyan
npm run dev
