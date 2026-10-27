$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'runtime.ps1')
New-Item -ItemType Directory -Force .runtime | Out-Null
$cli = "$PSScriptRoot/bin/devtunnel.exe"
if (-not (Test-Path -LiteralPath $cli)) {
    $installed=Get-Command devtunnel.exe -ErrorAction SilentlyContinue
    if (-not $installed) { throw '请先安装微软 Dev Tunnels，或将官方 devtunnel.exe 放入 bin 目录' }
    $cli=$installed.Source
}
$signature = Get-AuthenticodeSignature -LiteralPath $cli
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
    throw '微软工具签名校验未通过'
}
$userInfo = & $cli user show 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $userInfo -match 'Not logged in') {
    & $cli user login --use-device-code-auth --entra
    if ($LASTEXITCODE -ne 0) { throw '请先完成微软账号登录' }
}
if (-not (Test-Path node_modules)) {
    npm.cmd ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw '网页依赖安装失败' }
}
$env:COOKIE_SECURE = '1'
$running = $false
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/health' -TimeoutSec 3
    $running = $health.service -eq 'hongguo-web'
} catch {}
if (-not $running) {
    Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot/.runtime/server.log" -RedirectStandardError "$PSScriptRoot/.runtime/server-error.log" | Out-Null
}
$stateFile = "$PSScriptRoot/.microsoft-tunnel.json"
if (Test-Path $stateFile) {
    $tunnelId = (Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json).id
} else {
    $tunnelId = 'hongguo-web-' + ([Guid]::NewGuid().ToString('N').Substring(0,8))
    $result = & $cli create $tunnelId --allow-anonymous --expiration 30d --host-header unchanged --origin-header unchanged --json
    if ($LASTEXITCODE -ne 0) { throw '微软隧道创建失败' }
    & $cli port create $tunnelId -p 8790 --protocol http --host-header unchanged --origin-header unchanged
    if ($LASTEXITCODE -ne 0) { throw '微软隧道端口配置失败' }
    @{id=$tunnelId} | ConvertTo-Json | Set-Content -Encoding UTF8 $stateFile
}
Write-Host '正在连接微软外网地址。请保持本窗口运行；网站访问密码仍保存在 .private-config.json 中。'
& $cli host $tunnelId --host-header unchanged --origin-header unchanged
