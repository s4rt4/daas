$env:PORT = "3017"
$appUrl = "http://localhost:$env:PORT/app"
$nodeExe = "C:\Users\Sarta\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (-not (Test-Path -LiteralPath $nodeExe)) {
  Write-Host "Node runtime tidak ditemukan di $nodeExe"
  exit 1
}

Set-Location "C:\laragon\www\daas-v3"
Write-Host "Menjalankan DaaS Local Docs di $appUrl"
Start-Job -ScriptBlock {
  param($url)
  Start-Sleep -Seconds 2
  Start-Process $url
} -ArgumentList $appUrl | Out-Null
& $nodeExe "server.js"
