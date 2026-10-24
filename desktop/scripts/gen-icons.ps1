# Generate Luogu Desktop icons: blue rounded square + white glyph (U+6D1B).
# ASCII-only source so Windows PowerShell 5.1 (ANSI default) can parse it.
Add-Type -AssemblyName System.Drawing

$dir = Join-Path $PSScriptRoot "..\src\assets"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$glyph = [char]0x6D1B

function New-RoundedPath([int]$size) {
  $r = [Math]::Max(2, [int]($size * 0.22))
  $d = $r * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  $path = New-RoundedPath $size
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 91, 140, 255))
  $g.FillPath($brush, $path)

  if ($size -ge 24) {
    $fontPx = [float]($size * 0.58)
    $font = New-Object System.Drawing.Font("Microsoft YaHei", $fontPx, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString($glyph, $font, [System.Drawing.Brushes]::White, $rect, $sf)
    $font.Dispose()
  } elseif ($size -ge 16) {
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [float]([Math]::Max(1.5, $size * 0.12)))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($pen, [float]($size * 0.28), [float]($size * 0.5), [float]($size * 0.72), [float]($size * 0.5))
    $pen.Dispose()
  }

  $outFile = Join-Path $dir ("icon-" + $size + ".png")
  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  $path.Dispose()
  $brush.Dispose()
  Write-Host ("  ok  icon-" + $size + ".png")
}

# Taskbar overlay badges: blue circle + check (AC), red circle + X (WA)
function New-Overlay($name, $color, $check) {
  $bmp = New-Object System.Drawing.Bitmap(32, 32)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush($color)
  $g.FillEllipse($brush, 2, 2, 28, 28)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 4)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  if ($check) {
    $g.DrawLines($pen, @(
      (New-Object System.Drawing.PointF(9, 16)),
      (New-Object System.Drawing.PointF(14, 21)),
      (New-Object System.Drawing.PointF(23, 11))
    ))
  } else {
    $g.DrawLine($pen, 10, 10, 22, 22)
    $g.DrawLine($pen, 22, 10, 10, 22)
  }
  $bmp.Save((Join-Path $dir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $pen.Dispose()
  Write-Host ("  ok  " + $name)
}
New-Overlay "overlay-ac.png" ([System.Drawing.Color]::FromArgb(255, 62, 207, 142)) $true
New-Overlay "overlay-wa.png" ([System.Drawing.Color]::FromArgb(255, 240, 97, 109)) $false
