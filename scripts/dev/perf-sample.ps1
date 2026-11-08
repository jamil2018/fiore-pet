# Samples idle CPU% and RAM for fiore.exe plus its WebView2 child tree.
# CPU% = Δ(sum TotalProcessorTime) / (elapsed × logical cores) × 100, every 5 s.
# No window titles or media track names are printed.
[CmdletBinding()]
param(
  [string]$ProcessName = 'fiore',
  [int]$WarmupSec = 30,
  [int]$DurationSec = 120,
  [switch]$Json
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Continue'

$IntervalSec = 5
$Usage = @'
usage: scripts/dev/perf-sample.ps1 [-ProcessName fiore] [-WarmupSec 30] [-DurationSec 120] [-Json]

Finds ProcessName.exe, walks Win32_Process ParentProcessId for the WebView2 child tree,
samples CPU and RAM every 5 s after warmup, and prints mean + p95 CPU plus private/working-set RAM
for the root process and the whole tree. Exits 1 if the process is missing.
'@

function Write-ErrLine([string]$Message) {
  [Console]::Error.WriteLine($Message)
}

if ($WarmupSec -lt 0 -or $DurationSec -lt $IntervalSec) {
  Write-ErrLine "perf-sample: -WarmupSec must be >= 0 and -DurationSec must be >= $IntervalSec"
  Write-ErrLine $Usage
  exit 2
}

function Get-LogicalCoreCount {
  $n = [Environment]::ProcessorCount
  if ($n -gt 0) { return [int]$n }
  try {
    $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
    return [int]$cs.NumberOfLogicalProcessors
  } catch {
    return 1
  }
}

function Get-ProcessNameKey([string]$Name) {
  if ($Name.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase)) {
    return $Name.Substring(0, $Name.Length - 4)
  }
  return $Name
}

function Get-ItemCount($Value) {
  if ($null -eq $Value) { return 0 }
  if ($Value -is [System.Collections.ICollection]) { return [int]$Value.Count }
  return @($Value).Count
}

function Get-NamedProcesses([string]$Name) {
  $key = Get-ProcessNameKey $Name
  $found = Get-Process -Name $key -ErrorAction SilentlyContinue
  if ($null -eq $found) { return @() }
  return @($found)
}

function Get-ChildIdMap {
  $map = @{}
  $rows = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |
    Select-Object ProcessId, ParentProcessId)
  foreach ($row in $rows) {
    $ppid = [int]$row.ParentProcessId
    $procId = [int]$row.ProcessId
    if (-not $map.ContainsKey($ppid)) {
      $map[$ppid] = New-Object System.Collections.Generic.List[int]
    }
    [void]$map[$ppid].Add($procId)
  }
  return $map
}

function Get-ProcessTreeIds([int]$RootId) {
  $children = Get-ChildIdMap
  $ids = New-Object System.Collections.Generic.List[int]
  $stack = New-Object System.Collections.Generic.Stack[int]
  $seen = @{}
  $stack.Push($RootId)
  while ($stack.Count -gt 0) {
    $id = $stack.Pop()
    if ($seen.ContainsKey($id)) { continue }
    $seen[$id] = $true
    [void]$ids.Add($id)
    if ($children.ContainsKey($id)) {
      foreach ($child in $children[$id]) {
        $stack.Push([int]$child)
      }
    }
  }
  return @($ids)
}

function Select-RootProcess {
  param([object[]]$Candidates)
  $list = @($Candidates | Where-Object { $null -ne $_ })
  if ((Get-ItemCount $list) -le 1) { return $list[0] }
  $ranked = @()
  foreach ($proc in $list) {
    $treeCount = 1
    try { $treeCount = Get-ItemCount (Get-ProcessTreeIds ([int]$proc.Id)) } catch { }
    $ranked += [pscustomobject]@{
      Proc = $proc
      TreeCount = $treeCount
      StartTime = $proc.StartTime
    }
  }
  $withTree = @($ranked | Where-Object { $_.TreeCount -gt 1 })
  $pool = $withTree
  if ((Get-ItemCount $pool) -eq 0) { $pool = $ranked }
  return ($pool | Sort-Object TreeCount, StartTime -Descending | Select-Object -First 1).Proc
}

function Get-CpuSecondsByPid([int[]]$Ids) {
  $map = @{}
  foreach ($id in $Ids) {
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    try {
      $map[$id] = [double]$proc.TotalProcessorTime.TotalSeconds
    } catch {
      # Access denied or exited between lookup and read: skip this pid this sample.
    }
  }
  return $map
}

function Get-RamBytes([int[]]$Ids, [int]$RootId) {
  $rootPrivate = [int64]0
  $rootWs = [int64]0
  $treePrivate = [int64]0
  $treeWs = [int64]0
  $alive = New-Object System.Collections.Generic.List[int]
  foreach ($id in $Ids) {
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    try {
      $priv = [int64]$proc.PrivateMemorySize64
      $ws = [int64]$proc.WorkingSet64
    } catch {
      continue
    }
    [void]$alive.Add($id)
    $treePrivate += $priv
    $treeWs += $ws
    if ($id -eq $RootId) {
      $rootPrivate = $priv
      $rootWs = $ws
    }
  }
  return @{
    RootPrivate = $rootPrivate
    RootWs = $rootWs
    TreePrivate = $treePrivate
    TreeWs = $treeWs
    AliveIds = @($alive)
  }
}

function Get-Mean([double[]]$Values) {
  if ((Get-ItemCount $Values) -eq 0) { return $null }
  return [double]($Values | Measure-Object -Average).Average
}

function Get-Percentile {
  param([double[]]$Values, [double]$Percent)
  if ((Get-ItemCount $Values) -eq 0) { return $null }
  $sorted = @($Values | Sort-Object)
  $n = Get-ItemCount $sorted
  $rank = [int][Math]::Ceiling($Percent / 100.0 * $n)
  if ($rank -lt 1) { $rank = 1 }
  if ($rank -gt $n) { $rank = $n }
  return [double]$sorted[$rank - 1]
}

function Format-Mb([double]$Bytes) {
  return '{0:N1}' -f ($Bytes / 1MB)
}

function Format-Pct([double]$Value) {
  return '{0:N3}' -f $Value
}

$cores = Get-LogicalCoreCount
if ($cores -lt 1) { $cores = 1 }

$named = Get-NamedProcesses $ProcessName
if ((Get-ItemCount $named) -eq 0) {
  Write-ErrLine "perf-sample: process '$ProcessName' not found"
  exit 1
}
$root = Select-RootProcess $named
$rootId = [int]$root.Id

function Assert-RootAlive {
  $alive = Get-Process -Id $rootId -ErrorAction SilentlyContinue
  if (-not $alive) {
    Write-ErrLine "perf-sample: process '$ProcessName' pid=$rootId exited"
    exit 1
  }
}

if ($WarmupSec -gt 0) {
  $warmed = 0
  while ($warmed -lt $WarmupSec) {
    Assert-RootAlive
    $slice = [Math]::Min($IntervalSec, $WarmupSec - $warmed)
    Start-Sleep -Seconds $slice
    $warmed += $slice
  }
}

Assert-RootAlive
$sampleTarget = [int][Math]::Floor($DurationSec / [double]$IntervalSec)
$treeIds = @(Get-ProcessTreeIds $rootId)
$prevCpu = Get-CpuSecondsByPid $treeIds
$sw = [Diagnostics.Stopwatch]::StartNew()

$cpuSamples = New-Object System.Collections.Generic.List[double]
$rootPrivateSamples = New-Object System.Collections.Generic.List[double]
$rootWsSamples = New-Object System.Collections.Generic.List[double]
$treePrivateSamples = New-Object System.Collections.Generic.List[double]
$treeWsSamples = New-Object System.Collections.Generic.List[double]
$lastTreeIds = $treeIds

for ($n = 0; $n -lt $sampleTarget; $n++) {
  Start-Sleep -Seconds $IntervalSec
  Assert-RootAlive
  $elapsed = $sw.Elapsed.TotalSeconds
  if ($elapsed -le 0) { continue }
  $sw.Restart()

  $treeIds = @(Get-ProcessTreeIds $rootId)
  $lastTreeIds = $treeIds
  $nowCpu = Get-CpuSecondsByPid $treeIds
  $deltaCpu = 0.0
  foreach ($id in $nowCpu.Keys) {
    if ($prevCpu.ContainsKey($id)) {
      $step = [double]$nowCpu[$id] - [double]$prevCpu[$id]
      if ($step -gt 0) { $deltaCpu += $step }
    }
  }
  $prevCpu = $nowCpu
  $cpuPct = ($deltaCpu / ($elapsed * $cores)) * 100.0
  if ($cpuPct -lt 0) { $cpuPct = 0 }
  [void]$cpuSamples.Add($cpuPct)

  $ram = Get-RamBytes $treeIds $rootId
  [void]$rootPrivateSamples.Add([double]$ram.RootPrivate)
  [void]$rootWsSamples.Add([double]$ram.RootWs)
  [void]$treePrivateSamples.Add([double]$ram.TreePrivate)
  [void]$treeWsSamples.Add([double]$ram.TreeWs)
}

if ((Get-ItemCount $cpuSamples) -eq 0) {
  Write-ErrLine "perf-sample: no samples collected (increase -DurationSec)"
  exit 1
}

$cpuArr = [double[]]$cpuSamples.ToArray()
$rootPrivArr = [double[]]$rootPrivateSamples.ToArray()
$rootWsArr = [double[]]$rootWsSamples.ToArray()
$treePrivArr = [double[]]$treePrivateSamples.ToArray()
$treeWsArr = [double[]]$treeWsSamples.ToArray()

$result = [ordered]@{
  processName = (Get-ProcessNameKey $ProcessName)
  pid = $rootId
  treePids = @($lastTreeIds)
  cores = $cores
  warmupSec = $WarmupSec
  durationSec = $DurationSec
  intervalSec = $IntervalSec
  samples = $cpuArr.Count
  cpu = [ordered]@{
    mean = [Math]::Round((Get-Mean $cpuArr), 3)
    p95 = [Math]::Round((Get-Percentile -Values $cpuArr -Percent 95), 3)
  }
  ram = [ordered]@{
    fiore = [ordered]@{
      privateBytes = [ordered]@{
        mean = [int64][Math]::Round((Get-Mean $rootPrivArr), 0)
        max = [int64]($rootPrivArr | Measure-Object -Maximum).Maximum
      }
      workingSet = [ordered]@{
        mean = [int64][Math]::Round((Get-Mean $rootWsArr), 0)
        max = [int64]($rootWsArr | Measure-Object -Maximum).Maximum
      }
    }
    tree = [ordered]@{
      privateBytes = [ordered]@{
        mean = [int64][Math]::Round((Get-Mean $treePrivArr), 0)
        max = [int64]($treePrivArr | Measure-Object -Maximum).Maximum
      }
      workingSet = [ordered]@{
        mean = [int64][Math]::Round((Get-Mean $treeWsArr), 0)
        max = [int64]($treeWsArr | Measure-Object -Maximum).Maximum
      }
    }
  }
}

if ($Json) {
  $result | ConvertTo-Json -Depth 6
  exit 0
}

$cpuMean = $result.cpu.mean
$cpuP95 = $result.cpu.p95
$treeList = ($result.treePids -join ',')
Write-Output ("process: {0} pid={1} tree=[{2}] cores={3}" -f $result.processName, $result.pid, $treeList, $result.cores)
Write-Output ("warmup: {0}s  duration: {1}s  interval: {2}s  samples: {3}" -f $result.warmupSec, $result.durationSec, $result.intervalSec, $result.samples)
Write-Output ("cpu mean: {0}%  p95: {1}%" -f (Format-Pct $cpuMean), (Format-Pct $cpuP95))
Write-Output ("ram {0}  private mean={1}MB max={2}MB  ws mean={3}MB max={4}MB" -f `
  $result.processName, `
  (Format-Mb $result.ram.fiore.privateBytes.mean), (Format-Mb $result.ram.fiore.privateBytes.max), `
  (Format-Mb $result.ram.fiore.workingSet.mean), (Format-Mb $result.ram.fiore.workingSet.max))
Write-Output ("ram tree   private mean={0}MB max={1}MB  ws mean={2}MB max={3}MB" -f `
  (Format-Mb $result.ram.tree.privateBytes.mean), (Format-Mb $result.ram.tree.privateBytes.max), `
  (Format-Mb $result.ram.tree.workingSet.mean), (Format-Mb $result.ram.tree.workingSet.max))
exit 0
