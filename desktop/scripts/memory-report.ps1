param([switch]$Json)
$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$repo = Split-Path -Parent $desktop
$allElectron = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "electron.exe" })
$selected = [System.Collections.Generic.HashSet[int]]::new()
foreach ($proc in $allElectron) {
  $line = [string]$proc.CommandLine
  if ($line -notmatch [regex]::Escape($repo) -and $line -notmatch "Luogu Desktop" -and $line -notmatch "luogu-desktop") { continue }
  $cursor = $proc
  while ($cursor -and $cursor.Name -eq "electron.exe" -and $selected.Add([int]$cursor.ProcessId)) {
    $parentId = [int]$cursor.ParentProcessId
    $cursor = $allElectron | Where-Object { $_.ProcessId -eq $parentId } | Select-Object -First 1
  }
}
$procs = @($allElectron | Where-Object { $selected.Contains([int]$_.ProcessId) })
$rows = foreach ($proc in $procs) {
  $gp = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
  if (-not $gp) { continue }
  $type = if ($proc.CommandLine -match "--type=([^ ]+)") { $matches[1] } else { "main" }
  [pscustomobject]@{
    pid = $proc.ProcessId
    type = $type
    workingSetMB = [math]::Round($gp.WorkingSet64 / 1MB, 1)
    privateMB = [math]::Round($gp.PrivateMemorySize64 / 1MB, 1)
    cpuSeconds = [math]::Round($gp.CPU, 1)
  }
}
$totalWs = [math]::Round((($rows | Measure-Object workingSetMB -Sum).Sum), 1)
$totalPrivate = [math]::Round((($rows | Measure-Object privateMB -Sum).Sum), 1)
$report = [pscustomobject]@{
  measuredAt = (Get-Date).ToString("o")
  processCount = @($rows).Count
  totalWorkingSetMB = $totalWs
  totalPrivateMB = $totalPrivate
  targetMB = 100
  targetMet = (@($rows).Count -gt 0 -and $totalPrivate -lt 100)
  processes = @($rows | Sort-Object type,pid)
}
$outDir = Join-Path $repo ".lg-dev"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$outFile = Join-Path $outDir "memory-report.json"
[IO.File]::WriteAllText($outFile, ($report | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
if ($Json) {
  $report | ConvertTo-Json -Depth 5
} else {
  $rows | Sort-Object type,pid | Format-Table -AutoSize
  Write-Output ("TOTAL_PRIVATE_MB=" + $totalPrivate)
  Write-Output ("TOTAL_WORKINGSET_MB=" + $totalWs)
  Write-Output ("TARGET_100MB=" + $report.targetMet)
  Write-Output ("REPORT=" + $outFile)
}
if (-not $report.targetMet) { exit 2 }