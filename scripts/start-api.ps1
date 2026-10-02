$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$EnvFile = Join-Path $Root ".env"
if (-not (Test-Path $EnvFile)) {
    Write-Host "Missing .env - run setup-local.ps1" -ForegroundColor Red
    exit 1
}
Set-Location (Join-Path $Root "api")
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
    }
}
Write-Host "Starting API on http://127.0.0.1:5000" -ForegroundColor Cyan
& .\.venv\Scripts\python.exe app.py
