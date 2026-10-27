$ErrorActionPreference = 'Stop'
$configFile=Join-Path $PSScriptRoot '.local-runtime.json'
if (Test-Path -LiteralPath $configFile) {
    $runtime=Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    if ($runtime.ffmpeg -and (Test-Path -LiteralPath $runtime.ffmpeg)) { $env:HGTV_FFMPEG=$runtime.ffmpeg }
}
if (-not $env:HGTV_FFMPEG) {
    $tool=Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if ($tool) { $env:HGTV_FFMPEG=$tool.Source }
}
