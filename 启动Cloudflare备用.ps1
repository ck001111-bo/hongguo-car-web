$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'runtime.ps1')
New-Item -ItemType Directory -Force .runtime | Out-Null
if (-not (Test-Path node_modules)) {
    npm.cmd ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
}
$nodePath = (Get-Command node.exe).Source
$env:COOKIE_SECURE = '1'
$alreadyRunning = $false
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/health' -TimeoutSec 3
    $alreadyRunning = $health.service -eq 'hongguo-web'
} catch {}
if (-not $alreadyRunning) {
    Start-Process -FilePath $nodePath -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot/.runtime/server.log" -RedirectStandardError "$PSScriptRoot/.runtime/server-error.log" | Out-Null
}
$binary = "$PSScriptRoot/bin/cloudflared.exe"
if ((Get-AuthenticodeSignature -LiteralPath $binary).Status -ne 'Valid') { throw '公网连接程序签名校验未通过' }
$tunnelLog = "$PSScriptRoot/.runtime/tunnel-error.log"
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$tunnelLog = "$PSScriptRoot/.runtime/tunnel-$stamp.log"
Start-Process -FilePath $binary -ArgumentList @('tunnel','--url','http://127.0.0.1:8790','--protocol','http2','--no-autoupdate') -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot/.runtime/tunnel-output-$stamp.log" -RedirectStandardError $tunnelLog | Out-Null
$deadline = [DateTime]::UtcNow.AddSeconds(45)
do {
    Start-Sleep -Milliseconds 500
    if (Test-Path $tunnelLog) {
        $match = [regex]::Match((Get-Content -LiteralPath $tunnelLog -Raw),'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($match.Success) {
            $config = Get-Content -LiteralPath '.private-config.json' -Raw | ConvertFrom-Json
            "地址：$($match.Value)`r`n密码：$($config.password)`r`n临时地址，关闭电脑或连接程序后不可用。完整播放尚未验收。" | Set-Content -Encoding UTF8 '.runtime/本次访问说明.txt'
            Write-Host "访问地址：$($match.Value)"
            Write-Host '密码保存在 .runtime/本次访问说明.txt。电脑需要保持开机。'
            exit 0
        }
    }
} while ([DateTime]::UtcNow -lt $deadline)
throw "未能建立公网连接，请查看 $tunnelLog"
