$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'runtime.ps1')
if (-not (Test-Path node_modules)) { npm.cmd ci --ignore-scripts --no-audit --no-fund }
node server.mjs
