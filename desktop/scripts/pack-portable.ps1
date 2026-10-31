# 便携包打包：Electron 运行时 + resources/app（package.json + src/）。
# 产物：repo/.lg-dev/dist/luogu-desktop-<版本>-portable.zip
# 解压后双击根目录 electron.exe 即运行（resources/app 为约定布局）。
# 说明：未签名、无自动更新——按 ROADMAP 排期在 v1.0 接入 electron-builder。
$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $desktop
$pkgText = Get-Content (Join-Path $desktop "package.json") -Raw -Encoding UTF8
$ver = [regex]::Match($pkgText, '"version"\s*:\s*"([0-9.]+)"').Groups[1].Value
if (-not $ver) { throw "无法从 package.json 解析版本号" }
$stage = Join-Path $env:TEMP ("lg-pack-" + $ver)
$dist = Join-Path $repo ".lg-dev\dist"
$zip = Join-Path $dist ("luogu-desktop-" + $ver + "-portable.zip")

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path $dist -Force | Out-Null

# 1) Electron 运行时（node_modules/electron/dist 即完整运行时目录）
Copy-Item (Join-Path $desktop "node_modules\electron\dist\*") $stage -Recurse -Force
# 2) 应用源码进 resources/app（Electron 约定：该目录存在则直接加载）
$appDir = Join-Path $stage "resources\app"
New-Item -ItemType Directory -Path $appDir | Out-Null
Copy-Item (Join-Path $desktop "package.json") $appDir
Copy-Item (Join-Path $desktop "src") (Join-Path $appDir "src") -Recurse

# 3) 布局自检：主程序与入口齐全
$exe = Join-Path $stage "electron.exe"
if (-not (Test-Path $exe)) { throw "electron.exe 缺失" }
if (-not (Test-Path (Join-Path $appDir "package.json"))) { throw "resources/app/package.json 缺失" }
if (-not (Test-Path (Join-Path $appDir "src\main\index.js"))) { throw "src/main/index.js 缺失" }

# 4) 压缩
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Output ("PACK-OK " + $zip + " (" + $mb + " MB)")
