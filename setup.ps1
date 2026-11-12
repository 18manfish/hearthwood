# Hearthwood - one-time setup for Windows.
# Run from this folder:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = 'Stop'

function Test-Cmd($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

if (-not (Test-Cmd node)) {
  Write-Host 'Node.js not found - installing Node.js LTS with winget...' -ForegroundColor Yellow
  if (-not (Test-Cmd winget)) { throw 'winget is not available. Install Node.js 22.13+ (LTS) from https://nodejs.org and re-run this script.' }
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  # Make node/npm visible in this session.
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

$ver = (node -v).TrimStart('v').Split('.')
$major = [int]$ver[0]; $minor = [int]$ver[1]
# The server's database uses Node's built-in SQLite (node:sqlite), available from 22.13.
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) {
  Write-Host "Node $(node -v) is too old - updating to the current LTS with winget..." -ForegroundColor Yellow
  winget upgrade --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  throw 'Node.js was updated. Close this window, open a new PowerShell and run setup.ps1 again. (If winget could not update it, install the LTS version from https://nodejs.org.)'
}
Write-Host "Using Node $(node -v), npm $(npm -v)" -ForegroundColor Green

Write-Host 'Installing dependencies...' -ForegroundColor Cyan
npm install

Write-Host ''
Write-Host 'All set! Start the game with:' -ForegroundColor Green
Write-Host '  npm run dev        (normal speed)'
Write-Host '  npm run dev:fast   (time x60 + dev chat commands)'
Write-Host 'then open http://localhost:5173'

if (Test-Cmd code) { code . }
