# 便携包打包：Electron 运行时 + resources/app（package.json + src/）。
# 产物：repo/.lg-dev/dist/luogu-desktop-<版本>-portable.zip
# 解压后双击根目录 Luogu Desktop.exe 即运行（resources/app 为约定布局）。
# 说明：未签名、无自动更新——按 ROADMAP 排期在 v1.0 接入 electron-builder。
$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $desktop
$pkgText = Get-Content (Join-Path $desktop "package.json") -Raw -Encoding UTF8
$ver = [regex]::Match($pkgText, '"version"\s*:\s*"([0-9.]+)"').Groups[1].Value
if (-not $ver) { throw "无法从 package.json 解析版本号" }
# 唯一 stage 名：防上一次运行的残留句柄锁住同路径（Copy-Item IOException）
$stage = Join-Path $env:TEMP ("lg-pack-" + $ver + "-" + (Get-Date -Format "HHmmss"))
$dist = Join-Path $repo ".lg-dev\dist"
$archive = Join-Path $dist ("luogu-desktop-" + $ver + "-portable.7z")
$portableExe = Join-Path $dist ("luogu-desktop-" + $ver + "-portable.exe")

# 0) 清理同前缀旧产物（防坏包误分发，如版本号解析失败的残包）
if (Test-Path $dist) { Remove-Item (Join-Path $dist "luogu-desktop-*portable.zip") -Force -ErrorAction SilentlyContinue; Remove-Item (Join-Path $dist "luogu-desktop-*portable.7z") -Force -ErrorAction SilentlyContinue; Remove-Item (Join-Path $dist "luogu-desktop-*portable.exe") -Force -ErrorAction SilentlyContinue }

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path $dist -Force | Out-Null

# 1) Electron 运行时（node_modules/electron/dist 即完整运行时目录）
#    用户实例可能正从该目录运行（资源文件被读锁）：robocopy 自带重试，
#    退出码 <=7 均视为成功。
$src = Join-Path $desktop "node_modules\electron\dist"
robocopy $src $stage /E /NFL /NDL /NJH /NJS /R:5 /W:1 | Out-Null
if ($LASTEXITCODE -gt 7) { throw "robocopy 复制运行时失败（exit=$LASTEXITCODE）" }
$LASTEXITCODE = 0
# 2) 应用源码进 resources/app（Electron 约定：该目录存在则直接加载）
$appDir = Join-Path $stage "resources\app"
New-Item -ItemType Directory -Path $appDir | Out-Null
Copy-Item (Join-Path $desktop "package.json") $appDir
Copy-Item (Join-Path $desktop "src") (Join-Path $appDir "src") -Recurse

# 2.5) 体积收敛：只保留中文/英文 Chromium 语言包，移除默认应用占位资源。
$localeDir = Join-Path $stage "locales"
if (Test-Path $localeDir) {
  $keepLocales = @("zh-CN.pak", "zh-TW.pak", "en-US.pak")
  Get-ChildItem $localeDir -File | Where-Object { $_.Name -notin $keepLocales } | Remove-Item -Force
}
Remove-Item (Join-Path $stage "resources\default_app.asar") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $stage "debug.log") -Force -ErrorAction SilentlyContinue
# 3) Windows 资源：写回洛谷图标、产品名、版本号，并换成正式执行体名称。
$sourceExe = Join-Path $stage "electron.exe"
$exe = Join-Path $stage "Luogu Desktop.exe"
$icon = Join-Path $desktop "src\assets\icon.ico"
if (-not (Test-Path $sourceExe)) { throw "electron.exe 缺失" }
& node (Join-Path $desktop "scripts\patch-exe.js") $sourceExe $exe $icon
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) { throw "写入应用 EXE 图标/版本资源失败" }
Remove-Item $sourceExe -Force
$vi = (Get-Item -LiteralPath $exe).VersionInfo
if ($vi.ProductName -ne "Luogu Desktop" -or $vi.FileDescription -ne "洛谷桌面版") {
  throw "应用 EXE 版本资源未生效"
}
# 布局自检：主程序与入口齐全
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

# 5.2) 出包启动自检：对**暂存产物本身**启动一次（隔离 profile），确认剥离后主进程不崩。
#      第 4 步冒烟跑的是 desktop/ 开发态，看不到「剥了文件却仍被 require」这类崩法
#      ——v0.7.15 便携包就是这样带着 Error 弹窗出厂的。
$bootUd = Join-Path $env:TEMP ("lg-boot-" + $ver)
if (Test-Path $bootUd) { Remove-Item $bootUd -Recurse -Force }
$bootErr = Join-Path $env:TEMP ("lg-boot-" + $ver + ".err.txt")
if (Test-Path $bootErr) { Remove-Item $bootErr -Force }
$env:LG_USERDATA = $bootUd
$bootProc = Start-Process -FilePath $exe -PassThru -RedirectStandardError $bootErr
Start-Sleep -Seconds 9
$bootProc = Get-Process -Id $bootProc.Id -ErrorAction SilentlyContinue
$bootTitle = ""
if ($bootProc) { $bootProc.Refresh(); $bootTitle = [string]$bootProc.MainWindowTitle }
$bootAlive = $null -ne $bootProc
if ($bootAlive) { taskkill /PID $bootProc.Id /T /F | Out-Null }
Remove-Item Env:LG_USERDATA
Start-Sleep -Milliseconds 800
$bootErrText = if (Test-Path $bootErr) { [IO.File]::ReadAllText($bootErr) } else { "" }
Remove-Item $bootUd -Recurse -Force -ErrorAction SilentlyContinue
if (-not $bootAlive) { throw ("出包启动自检失败：暂存产物主进程启动后退出；stderr=" + $bootErrText) }
if ($bootTitle -like "*Error*" -or $bootErrText -match "Cannot find module|A JavaScript error occurred") {
  throw ("出包启动自检失败：暂存产物启动报错（窗口标题=" + $bootTitle + "）；stderr=" + $bootErrText)
}
Write-Output ("BOOT-OK " + $bootProc.Id + " title=" + $bootTitle)

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
  if ($signed.SignerCertificate) {
    $signLine = "SIGN-OK(self-signed) " + $cert.Thumbprint + " " + (Get-Date).ToUniversalTime().ToString("o")
    Write-Output $signLine
    Add-Content -Path $log -Value $signLine -Encoding UTF8   # 签名证据随包日志落盘（评审点名）
  } else {
    $warnLine = "SIGN-WARN " + $signed.Status
    Write-Output $warnLine
    Add-Content -Path $log -Value $warnLine -Encoding UTF8
  }
} catch {
  Write-Output ("SIGN-WARN " + $_.Exception.Message)
}

# 6) 压缩：7z LZMA2 单文件交付；体积写入日志，不设硬门槛。
$seven = @("C:\Program Files\7-Zip\7z.exe", "C:\Program Files (x86)\7-Zip\7z.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $seven) { throw "需要 7-Zip 以生成便携包" }
Push-Location $stage
try {
  & $seven a -t7z -mx=9 -mmt=on -y $archive * | Out-Null
  if ($LASTEXITCODE -gt 1) { throw "7-Zip 压缩失败（exit=$LASTEXITCODE）" }
} finally {
  Pop-Location
}
$sfxModule = Join-Path (Split-Path -Parent $seven) "7z.sfx"
if (Test-Path $sfxModule) {
  $patchedSfx = Join-Path $env:TEMP ("luogu-sfx-" + (Get-Date -Format "HHmmssfff") + ".exe")
  & node (Join-Path $desktop "scripts\patch-exe.js") $sfxModule $patchedSfx $icon
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $patchedSfx)) { throw "写入自解压 EXE 图标/版本资源失败" }
  $sfxVersion = (Get-Item -LiteralPath $patchedSfx).VersionInfo
  if ($sfxVersion.ProductName -ne "Luogu Desktop") { throw "自解压 EXE 版本资源未生效" }
  $out = [IO.File]::Create($portableExe)
  try {
    $sfxBytes = [IO.File]::ReadAllBytes($patchedSfx)
    $out.Write($sfxBytes, 0, $sfxBytes.Length)
    $archiveBytes = [IO.File]::ReadAllBytes($archive)
    $out.Write($archiveBytes, 0, $archiveBytes.Length)
  } finally {
    $out.Dispose()
  }
  Remove-Item $patchedSfx -Force -ErrorAction SilentlyContinue
  try {
    $signedSfx = Set-AuthenticodeSignature -FilePath $portableExe -Certificate $cert -ErrorAction SilentlyContinue
    if ($signedSfx.SignerCertificate) {
      Write-Output ("SIGN-OK(portable-sfx) " + $cert.Thumbprint)
    } else {
      Write-Output ("SIGN-WARN(portable-sfx) " + $signedSfx.Status)
    }
  } catch {
    Write-Output ("SIGN-WARN(portable-sfx) " + $_.Exception.Message)
  }
}
$sizeMb = [math]::Round((Get-Item $archive).Length / 1MB, 1)
$sfxMb = if (Test-Path $portableExe) { [math]::Round((Get-Item $portableExe).Length / 1MB, 1) } else { 0 }
if ($sfxMb -gt 0) {
  # SFX 已包含完整载荷；中间 7z 只用于构建，不再同时留在 dist 占用双份磁盘。
  Remove-Item $archive -Force -ErrorAction SilentlyContinue
  Write-Output ("PACK-OK " + $portableExe + " (" + $sfxMb + " MB); intermediate-7z=removed")
} else {
  Write-Output ("PACK-OK " + $archive + " (" + $sizeMb + " MB); SFX=unavailable")
}
