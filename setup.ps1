# Hearthwood – one-time setup for Windows.
# Run from this folder:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = 'Stop'

function Test-Cmd($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

if (-not (Test-Cmd node)) {
  Write-Host 'Node.js not found – installing Node.js LTS with winget…' -ForegroundColor Yellow
  if (-not (Test-Cmd winget)) { throw 'winget is not available. Install Node.js 20+ from https://nodejs.org and re-run this script.' }
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  # Make node/npm visible in this session.
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw "Node.js 20+ required (found $(node -v)). Update from https://nodejs.org" }
Write-Host "Using Node $(node -v), npm $(npm -v)" -ForegroundColor Green

Write-Host 'Installing dependencies…' -ForegroundColor Cyan
npm install

Write-Host ''
Write-Host 'All set! Start the game with:' -ForegroundColor Green
Write-Host '  npm run dev        (normal speed)'
Write-Host '  npm run dev:fast   (time x60 + dev chat commands)'
Write-Host 'then open http://localhost:5173'

if (Test-Cmd code) { code . }
