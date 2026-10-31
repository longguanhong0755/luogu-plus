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

# 0) 清理同前缀旧产物（防坏包误分发，如版本号解析失败的残包）
if (Test-Path $dist) { Remove-Item (Join-Path $dist "luogu-desktop-*portable.zip") -Force -ErrorAction SilentlyContinue }

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

# 4) 打包冒烟（证据落盘 + 完整裁决）：走带真裁决的 node 启动器——
#    SMOKE_FAIL/审计超零/exit code 全算数（裁决洞 #3 修复：v0.7.10 曾因只查
#    启动期 SMOKE_OK 标记而带红出厂）。
$ud = Join-Path $env:TEMP ("lg-pack-ud-" + $ver)
if (Test-Path $ud) { Remove-Item $ud -Recurse -Force }
$env:LG_USERDATA = $ud
$env:LG_SMOKE = "1"
$env:LG_DEMO = "1"
$env:LG_SMOKE_SEC = "1"
$env:LG_SMOKE_FIND = "1"
$env:LG_SMOKE_TIMEOUT = "540000"
$log = Join-Path $dist "pack-smoke.log"
$smokeJs = Join-Path $desktop "scripts\smoke.js"
cmd /c ("node `"" + $smokeJs + "`" > `"" + $log + "`" 2>&1")
$code = $LASTEXITCODE
Get-Content $log -Encoding UTF8 | Select-Object -Last 10 | Write-Output
Remove-Item Env:LG_USERDATA, Env:LG_SMOKE, Env:LG_DEMO, Env:LG_SMOKE_SEC, Env:LG_SMOKE_FIND, Env:LG_SMOKE_TIMEOUT
Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue
if ($code -ne 0) {
  throw "打包冒烟失败（启动器 exit=" + $code + "，含 SMOKE_FAIL 或裁决失败）；日志见 " + $log
}

# 5) 剥离探针 harness（--smoke 为唯一触发路径，正常使用零触发；产物不再携带
#    141KB 探针/演示代码）
Remove-Item (Join-Path $appDir "src\main\smoke.js") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $appDir "src\main\smoke-guard.js") -Force -ErrorAction SilentlyContinue
if ((Test-Path (Join-Path $appDir "src\main\smoke.js")) -or (Test-Path (Join-Path $appDir "src\main\smoke-guard.js"))) { throw "探针 harness 剥离失败" }

# 5.5) 自签过渡（证书采购前的方案，评审终态路径认可）：签主执行体，
#      证书公钥导出 dist 供信任安装；无签名能力时告警不阻断。
$cerPath = Join-Path $dist "luogu-desktop-selfsigned.cer"
try {
  $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -like "*Luogu Desktop*" } | Select-Object -First 1
  if (-not $cert) {
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Luogu Desktop (self-signed dev)" -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(3)
    if (Test-Path $cerPath) { Remove-Item $cerPath -Force }
    Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
  }
  $signed = Set-AuthenticodeSignature -FilePath $exe -Certificate $cert -ErrorAction SilentlyContinue
  # 自签链不受信 → Status=UnknownError 但签名已嵌入（SignerCertificate 非空）；
  # 受信判定交给用户安装 .cer 后的 Get-AuthenticodeSignature 校验
  if ($signed.SignerCertificate) { Write-Output ("SIGN-OK(self-signed) " + $cert.Thumbprint) }
  else { Write-Output ("SIGN-WARN " + $signed.Status) }
} catch {
  Write-Output ("SIGN-WARN " + $_.Exception.Message)
}

# 6) 压缩（剥离+签名后的 stage）
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)

Write-Output ("PACK-OK " + $zip + " (" + $mb + " MB)")
