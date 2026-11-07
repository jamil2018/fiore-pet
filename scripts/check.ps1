<#
.SYNOPSIS
  Fiore quality gate. CLI contract: docs/harness/README.md section 5.

.DESCRIPTION
  scripts/check.ps1 -Tier fast|full [-Scope <path[,path...]>]

  fast: rustfmt --check, clippy -D warnings, tsc --noEmit, biome, unit tests (cargo test, npm test),
        harness script syntax (node --check), docs-check
  full: fast + tauri build + golden replay tests (npm run test:golden)

  A step whose project does not exist yet is reported as SKIP (no src-tauri/Cargo.toml, no tsconfig.json,
  no biome.json, no `test` / `test:golden` script, no src-tauri/tauri.conf.json).
  A step whose project exists but whose tool/dependencies are missing FAILS (cargo not on PATH,
  node_modules missing): a missing toolchain must never look like a pass.

  -Scope limits which steps run to those that can be affected by the given repo-relative paths
  (comma separated). Rust steps run for paths under src-tauri/, TypeScript steps for src/, public/, evals/,
  scripts/dev/ and root web configs, harness syntax for scripts/ and evals/. docs-check always runs.
  biome checks only the in-scope TypeScript paths. tsc and test runners are project-wide.
  Full-tier build/golden steps are skipped when a fast step failed.

  Optional env: FIORE_TAURI_ARGS = extra arguments for `tauri build` (for example "--debug --no-bundle").

  Exit codes: 0 all steps passed or skipped, 1 a step failed, 2 usage error.
#>
[CmdletBinding()]
param(
  [string]$Tier = 'fast',
  [string[]]$Scope = @()
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version 2.0

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if ($Tier -ne 'fast' -and $Tier -ne 'full') {
  Write-Host "check.ps1: -Tier must be 'fast' or 'full' (got '$Tier')"
  exit 2
}

# ---- scope normalisation ----
$ScopePaths = @()
foreach ($item in $Scope) {
  foreach ($p in ($item -split ',')) {
    $p = $p.Trim()
    if ($p.Length -eq 0) { continue }
    $p = $p -replace '\\', '/'
    $rootFwd = $Root -replace '\\', '/'
    if ($p.StartsWith($rootFwd, [System.StringComparison]::OrdinalIgnoreCase)) {
      $p = $p.Substring($rootFwd.Length).TrimStart('/')
    }
    $p = $p -replace '^\./', ''
    $p = $p.TrimEnd('/')
    if ($p.Length -eq 0) { $p = '.' }
    $ScopePaths += $p
  }
}

function Test-Scope([string[]]$Prefixes) {
  if ($ScopePaths.Count -eq 0) { return $true }
  foreach ($s in $ScopePaths) {
    if ($s -eq '.') { return $true }
    foreach ($pre in $Prefixes) {
      if ($s -eq $pre -or $s.StartsWith("$pre/") -or $pre.StartsWith("$s/")) { return $true }
    }
  }
  return $false
}

$RustScope = @('src-tauri')
$TsScope = @('src', 'public', 'evals', 'scripts/dev', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'biome.json', 'vite.config.ts', 'vitest.config.ts')
$ScriptScope = @('scripts', 'evals')

function Test-Cmd([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# ---- package.json helpers ----
$Pkg = $null
if (Test-Path 'package.json') {
  try { $Pkg = Get-Content 'package.json' -Raw | ConvertFrom-Json } catch { $Pkg = $null }
}
function Test-NpmScript([string]$Name) {
  if ($null -eq $Pkg) { return $false }
  if (-not ($Pkg.PSObject.Properties.Name -contains 'scripts')) { return $false }
  return [bool]($Pkg.scripts.PSObject.Properties.Name -contains $Name)
}

# ---- step runner ----
$Results = New-Object System.Collections.ArrayList
$script:AnyFail = $false

function Add-Result([string]$Name, [string]$Status, [string]$Detail, [double]$Secs) {
  [void]$Results.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail; Secs = $Secs })
  $color = switch ($Status) { 'PASS' { 'Green' } 'FAIL' { 'Red' } default { 'Yellow' } }
  $suffix = ''
  if ($Detail) { $suffix = " - $Detail" }
  $time = ''
  if ($Status -ne 'SKIP') { $time = ' ({0:N1}s)' -f $Secs }
  Write-Host ("[{0}] {1}{2}{3}" -f $Status, $Name, $time, $suffix) -ForegroundColor $color
}

function Skip-Step([string]$Name, [string]$Reason) { Add-Result $Name 'SKIP' $Reason 0 }

function Fail-Step([string]$Name, [string]$Reason) {
  $script:AnyFail = $true
  Add-Result $Name 'FAIL' $Reason 0
}

function Invoke-Step([string]$Name, [scriptblock]$Action) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $global:LASTEXITCODE = 0
  $lines = @(& $Action 2>&1 | ForEach-Object { "$_" })
  $code = $global:LASTEXITCODE
  $sw.Stop()
  if ($code -eq 0) {
    Add-Result $Name 'PASS' '' $sw.Elapsed.TotalSeconds
  } else {
    $script:AnyFail = $true
    Add-Result $Name 'FAIL' "exit code $code" $sw.Elapsed.TotalSeconds
    $tail = $lines | Select-Object -Last 60
    foreach ($l in $tail) { Write-Host "    $l" }
  }
}

$HasRust = Test-Path 'src-tauri/Cargo.toml'
$HasTsconfig = Test-Path 'tsconfig.json'
$HasNodeModules = Test-Path 'node_modules'
$RustManifest = 'src-tauri/Cargo.toml'

Write-Host "check.ps1 -Tier $Tier$(if ($ScopePaths.Count) { ' -Scope ' + ($ScopePaths -join ',') })"

# ---- rust ----
foreach ($step in @(
    @{ Name = 'rustfmt'; Args = @('fmt', '--manifest-path', $RustManifest, '--all', '--', '--check') },
    @{ Name = 'clippy'; Args = @('clippy', '--manifest-path', $RustManifest, '--all-targets', '--', '-D', 'warnings') }
  )) {
  $n = $step.Name
  if (-not $HasRust) { Skip-Step $n 'no src-tauri/Cargo.toml yet'; continue }
  if (-not (Test-Scope $RustScope)) { Skip-Step $n 'out of scope'; continue }
  if (-not (Test-Cmd 'cargo')) { Fail-Step $n 'cargo not found on PATH'; continue }
  $cargoArgs = $step.Args
  Invoke-Step $n { & cargo @cargoArgs }
}

# ---- typescript ----
if (-not $HasTsconfig) {
  Skip-Step 'tsc' 'no tsconfig.json yet'
} elseif (-not (Test-Scope $TsScope)) {
  Skip-Step 'tsc' 'out of scope'
} elseif (-not $HasNodeModules) {
  Fail-Step 'tsc' 'node_modules missing (run npm ci)'
} else {
  Invoke-Step 'tsc' { & npx.cmd --no-install tsc --noEmit }
}

if (-not (Test-Path 'biome.json')) {
  Skip-Step 'biome' 'no biome.json yet'
} elseif (-not (Test-Scope $TsScope)) {
  Skip-Step 'biome' 'out of scope'
} elseif (-not $HasNodeModules) {
  Fail-Step 'biome' 'node_modules missing (run npm ci)'
} else {
  $biomePaths = @()
  foreach ($s in $ScopePaths) {
    if ($s -eq '.') { $biomePaths = @(); break }
    if ($s.StartsWith('src-tauri')) { continue }
    if ((Test-Path $s) -and (Test-Scope $TsScope)) { $biomePaths += $s }
  }
  if ($biomePaths.Count -eq 0) { $biomePaths = @('.') }
  Invoke-Step 'biome' { & npx.cmd --no-install biome check @biomePaths }
}

# ---- unit tests ----
if (-not $HasRust) {
  Skip-Step 'cargo test' 'no src-tauri/Cargo.toml yet'
} elseif (-not (Test-Scope $RustScope)) {
  Skip-Step 'cargo test' 'out of scope'
} elseif (-not (Test-Cmd 'cargo')) {
  Fail-Step 'cargo test' 'cargo not found on PATH'
} else {
  Invoke-Step 'cargo test' { & cargo test --manifest-path $RustManifest }
}

if (-not (Test-NpmScript 'test')) {
  Skip-Step 'npm test' 'no package.json "test" script yet'
} elseif (-not (Test-Scope $TsScope)) {
  Skip-Step 'npm test' 'out of scope'
} elseif (-not $HasNodeModules) {
  Fail-Step 'npm test' 'node_modules missing (run npm ci)'
} else {
  Invoke-Step 'npm test' { $env:CI = '1'; & npm.cmd test }
}

# ---- harness scripts + docs ----
$harnessScripts = @()
if (Test-Path 'scripts/harness') { $harnessScripts = @(Get-ChildItem 'scripts/harness' -Filter '*.mjs' -File | ForEach-Object { $_.FullName }) }
if ($harnessScripts.Count -eq 0) {
  Skip-Step 'harness syntax' 'no scripts/harness/*.mjs yet'
} elseif (-not (Test-Scope $ScriptScope)) {
  Skip-Step 'harness syntax' 'out of scope'
} elseif (-not (Test-Cmd 'node')) {
  Fail-Step 'harness syntax' 'node not found on PATH'
} else {
  Invoke-Step 'harness syntax' {
    foreach ($f in $harnessScripts) {
      & node --check $f
      if ($LASTEXITCODE -ne 0) { break }
    }
  }
}

if (-not (Test-Path 'scripts/harness/docs-check.mjs')) {
  Skip-Step 'docs-check' 'scripts/harness/docs-check.mjs missing'
} elseif (-not (Test-Cmd 'node')) {
  Fail-Step 'docs-check' 'node not found on PATH'
} else {
  Invoke-Step 'docs-check' { & node scripts/harness/docs-check.mjs }
}

# ---- full tier ----
if ($Tier -eq 'full') {
  $fastFailed = $script:AnyFail

  if (-not (Test-Path 'src-tauri/tauri.conf.json')) {
    Skip-Step 'tauri build' 'no src-tauri/tauri.conf.json yet'
  } elseif ($fastFailed) {
    Skip-Step 'tauri build' 'fast steps failed'
  } elseif (-not $HasNodeModules) {
    Fail-Step 'tauri build' 'node_modules missing (run npm ci)'
  } else {
    $extra = @()
    if ($env:FIORE_TAURI_ARGS) { $extra = @($env:FIORE_TAURI_ARGS -split '\s+' | Where-Object { $_ }) }
    if (Test-NpmScript 'tauri') {
      Invoke-Step 'tauri build' { & npm.cmd run tauri -- build @extra }
    } else {
      Invoke-Step 'tauri build' { & npx.cmd --no-install tauri build @extra }
    }
  }

  if (-not (Test-NpmScript 'test:golden')) {
    Skip-Step 'golden replay' 'no package.json "test:golden" script yet'
  } elseif ($fastFailed) {
    Skip-Step 'golden replay' 'fast steps failed'
  } elseif (-not $HasNodeModules) {
    Fail-Step 'golden replay' 'node_modules missing (run npm ci)'
  } else {
    Invoke-Step 'golden replay' { $env:CI = '1'; & npm.cmd run test:golden }
  }
}

# ---- summary ----
$pass = @($Results | Where-Object { $_.Status -eq 'PASS' }).Count
$fail = @($Results | Where-Object { $_.Status -eq 'FAIL' }).Count
$skip = @($Results | Where-Object { $_.Status -eq 'SKIP' }).Count
Write-Host ''
if ($fail -gt 0) {
  Write-Host "check $Tier FAILED: $fail failed, $pass passed, $skip skipped" -ForegroundColor Red
  exit 1
}
Write-Host "check $Tier OK: $pass passed, $skip skipped" -ForegroundColor Green
exit 0
