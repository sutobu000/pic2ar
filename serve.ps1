# web-ar静的サーバ起動: LAN IPv4とURLを表示してから0.0.0.0:8420で配信する
$ErrorActionPreference = 'Stop'

# デフォルトゲートウェイを持つUpなアダプタ=実際にWi-Fi/LANへ出ているIPを優先する
$ip = (Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
    Select-Object -First 1).IPv4Address.IPAddress
if (-not $ip) {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1).IPAddress
}

Write-Host ''
Write-Host '  web-ar server' -ForegroundColor Cyan
Write-Host "  iPhone (same Wi-Fi):  http://${ip}:8420" -ForegroundColor Green
Write-Host '  This PC:              http://localhost:8420'
Write-Host '  Stop:                 Ctrl+C'
Write-Host ''
Write-Host '  iPhoneから繋がらない場合: 初回起動時のWindowsファイアウォール確認で'
Write-Host '  「プライベートネットワーク」のアクセスを許可してください。'
Write-Host ''

# serve.py=.usdz/.glbに正しいMIMEを付ける簡易サーバ(iOS AR Quick Look対策)。
# 素のpython -m http.server 8420 --bind 0.0.0.0でも配信自体は可能だが、MIMEが汎用になる。
python (Join-Path $PSScriptRoot 'serve.py')
