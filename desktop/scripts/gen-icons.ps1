# Render the official blue Luogu mark from its local SVG source.
# The 1024px alpha master is created once, then reduced with Pillow; RGB is
# fixed to the official blue so no white matte or halo can survive scaling.
$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $desktop "src\assets"
$source = Join-Path $assets "luogu-mark.svg"
if (-not (Test-Path $source)) { throw "missing src/assets/luogu-mark.svg" }

$chromeCandidates = @(
  $env:LG_CHROME,
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) }
$chrome = $chromeCandidates | Select-Object -First 1
if (-not $chrome) { throw "Chrome or Edge is required to render the SVG" }
$python = (Get-Command python -ErrorAction Stop).Source

$svg = [IO.File]::ReadAllText($source)
$html = '<html><head><style>html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:transparent}svg{display:block;width:1024px;height:1024px}</style></head><body>' + $svg + '</body></html>'
$stamp = [DateTime]::UtcNow.Ticks
$htmlPath = Join-Path $env:TEMP ("luogu-icon-" + $stamp + ".html")
$master = Join-Path $env:TEMP ("luogu-icon-" + $stamp + ".png")
$profile = Join-Path $env:TEMP ("lg-icon-chrome-" + $stamp)
[IO.File]::WriteAllText($htmlPath, $html, [Text.Encoding]::UTF8)
$uri = "file:///" + ($htmlPath -replace "\\", "/")
$chromeArgs = @(
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--window-size=1024,1024", "--force-device-scale-factor=1",
  "--default-background-color=00000000",
  ("--screenshot=" + $master),
  ("--user-data-dir=" + $profile),
  $uri
)
$proc = Start-Process -FilePath $chrome -ArgumentList $chromeArgs -PassThru -Wait -WindowStyle Hidden
if ($proc.ExitCode -ne 0 -or -not (Test-Path $master)) { throw "Chrome icon render failed: exit=$($proc.ExitCode)" }

$assetScript = Join-Path $PSScriptRoot "build-icon-assets.py"
& $python $assetScript $master $assets
if ($LASTEXITCODE -ne 0) { throw "Pillow resize failed" }
$packScript = Join-Path $PSScriptRoot "pack-ico.js"
& node $packScript -Force
if ($LASTEXITCODE -ne 0) { throw "ICO packing failed" }
Write-Output "ICON-OK official mark, 10 sizes, transparent alpha"
