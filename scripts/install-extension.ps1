param([switch]$Uninstall, [string]$ExtensionId, [string]$DataDirectory, [ValidateSet('Chrome', 'Edge', 'Chromium')][string[]]$Browsers = @('Chrome', 'Edge', 'Chromium'))
$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$manifest = Get-Content -LiteralPath (Join-Path $projectDirectory 'extension\manifest.json') -Raw | ConvertFrom-Json
if (-not $ExtensionId) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hex = ([BitConverter]::ToString($sha.ComputeHash([Convert]::FromBase64String($manifest.key)))).Replace('-', '').ToLowerInvariant().Substring(0, 32)
    $ExtensionId = -join ($hex.ToCharArray() | ForEach-Object { [char](97 + [Convert]::ToInt32([string]$_, 16)) })
    $sha.Dispose()
}
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw 'Invalid extension ID' }
$browserKeys = @{ Chrome = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.caocao.library'; Edge = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.caocao.library'; Chromium = 'HKCU:\Software\Chromium\NativeMessagingHosts\com.caocao.library' }
$keys = @($Browsers | ForEach-Object { $browserKeys[$_] })
if ($Uninstall) {
    foreach ($key in $keys) { if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key } }
    Write-Host 'Da go ket noi Cao Cao. Du lieu thu vien van duoc giu nguyen.'
    exit
}
if (-not $DataDirectory) { $DataDirectory = if ($env:CAOCAO_DATA_DIR) { $env:CAOCAO_DATA_DIR } else { Join-Path $projectDirectory 'data' } }
$DataDirectory = [System.IO.Path]::GetFullPath($DataDirectory)
$nativeDirectory = Join-Path $DataDirectory 'native-host'
New-Item -ItemType Directory -Path $nativeDirectory -Force | Out-Null
$launcher = Join-Path $nativeDirectory 'launch.cmd'
$hostScript = Join-Path $projectDirectory 'scripts\native-host.mjs'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$launcherLines = @('@echo off', 'chcp 65001 >nul', ('set "CAOCAO_DATA_DIR={0}"' -f $DataDirectory.Replace('%', '%%')), ('"{0}" "{1}" %*' -f $nodePath.Replace('%', '%%'), $hostScript.Replace('%', '%%')))
[System.IO.File]::WriteAllLines($launcher, $launcherLines, $utf8)
$hostManifest = Join-Path $nativeDirectory 'com.caocao.library.json'
$hostJson = @{ name = 'com.caocao.library'; description = 'Cao Cao local learning library'; path = $launcher; type = 'stdio'; allowed_origins = @("chrome-extension://$ExtensionId/") } | ConvertTo-Json
[System.IO.File]::WriteAllText($hostManifest, $hostJson, $utf8)
foreach ($key in $keys) { New-Item -Path $key -Force | Out-Null; Set-Item -LiteralPath $key -Value $hostManifest }
Write-Host 'Da cai ket noi Cao Cao.'
Write-Host ('Thu muc extension: ' + (Join-Path $projectDirectory 'extension'))
Write-Host ('Extension ID: ' + $ExtensionId)
