# Build YesWeigh Service debug APK (Capacitor thin shell)
# Uses the same Android SDK as D:\census and Microsoft JDK 21.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$sdk = 'D:\census\tools\android-sdk'
$jdk = (Get-ChildItem 'C:\Program Files\Microsoft\jdk-21*' -Directory | Select-Object -First 1).FullName
if (-not $jdk) { throw 'Microsoft JDK 21 not found. Install with: winget install Microsoft.OpenJDK.21' }
if (-not (Test-Path $sdk)) { throw "Android SDK not found at $sdk" }

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$jdk\bin;$sdk\platform-tools;" + $env:Path

$localProps = Join-Path $Root 'android\local.properties'
@"
sdk.dir=$($sdk.Replace('\', '\\'))
"@ | Set-Content -Path $localProps -Encoding ASCII

Write-Host 'Syncing Capacitor...' -ForegroundColor Cyan
npm run cap:sync

Write-Host 'Building debug APK...' -ForegroundColor Cyan
Push-Location (Join-Path $Root 'android')
try {
  .\gradlew.bat assembleDebug --no-daemon
} finally {
  Pop-Location
}

$apk = Join-Path $Root 'android\app\build\outputs\apk\debug\yesone.apk'
if (-not (Test-Path $apk)) { throw "APK not found at $apk" }

Write-Host ''
Write-Host "APK ready: $apk" -ForegroundColor Green
Write-Host 'Install on phone: copy the file, or: adb install -r android\app\build\outputs\apk\debug\yesone.apk'
