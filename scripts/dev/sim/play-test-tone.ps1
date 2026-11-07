# Plays scripts/dev/sim/test-tone.wav (440 Hz, 4 s) so GSMTC sees a Playing session.
# Prefers Windows Media Player. Falls back to WinRT MediaPlayer, which also
# registers a system media session. SoundPlayer is not used: it never shows up
# in GSMTC, so the media sensor would stay silent.
[CmdletBinding()]
param(
  [switch]$Generate,
  [int]$Seconds = 0
)

Set-StrictMode -Version 2.0

$ToneSeconds = 4
$SampleRate = 8000
$WavPath = Join-Path $PSScriptRoot 'test-tone.wav'

function Add-Bytes {
  param([System.IO.MemoryStream]$Stream, [byte[]]$Bytes)
  $Stream.Write($Bytes, 0, $Bytes.Length)
}

function Add-Ascii {
  param([System.IO.MemoryStream]$Stream, [string]$Text)
  Add-Bytes $Stream ([System.Text.Encoding]::ASCII.GetBytes($Text))
}

function Add-Int32 {
  param([System.IO.MemoryStream]$Stream, [int]$Value)
  Add-Bytes $Stream ([BitConverter]::GetBytes($Value))
}

function Add-Int16 {
  param([System.IO.MemoryStream]$Stream, [int16]$Value)
  Add-Bytes $Stream ([BitConverter]::GetBytes($Value))
}

function Write-TestTone {
  param([string]$Path, [int]$DurationSeconds, [int]$Rate)
  $count = $Rate * $DurationSeconds
  $pcm = New-Object byte[] ($count * 2)
  for ($i = 0; $i -lt $count; $i++) {
    $sample = [int16][math]::Round([math]::Sin(2 * [math]::PI * 440.0 * $i / $Rate) * 12000)
    $bytes = [BitConverter]::GetBytes($sample)
    $pcm[$i * 2] = $bytes[0]
    $pcm[$i * 2 + 1] = $bytes[1]
  }
  $ms = New-Object System.IO.MemoryStream
  Add-Ascii $ms 'RIFF'
  Add-Int32 $ms (36 + $pcm.Length)
  Add-Ascii $ms 'WAVE'
  Add-Ascii $ms 'fmt '
  Add-Int32 $ms 16
  Add-Int16 $ms 1
  Add-Int16 $ms 1
  Add-Int32 $ms $Rate
  Add-Int32 $ms ($Rate * 2)
  Add-Int16 $ms 2
  Add-Int16 $ms 16
  Add-Ascii $ms 'data'
  Add-Int32 $ms $pcm.Length
  Add-Bytes $ms $pcm
  [System.IO.File]::WriteAllBytes($Path, $ms.ToArray())
}

function Find-Wmplayer {
  $candidates = @()
  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles 'Windows Media Player\wmplayer.exe')
  }
  $x86 = ${env:ProgramFiles(x86)}
  if ($x86) {
    $candidates += (Join-Path $x86 'Windows Media Player\wmplayer.exe')
  }
  $cmd = Get-Command wmplayer.exe -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
  foreach ($path in $candidates) {
    if ($path -and (Test-Path -LiteralPath $path)) { return $path }
  }
  return $null
}

function Await-WinRt {
  param($Operation, [type]$ResultType)
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  if (-not $asTask) { throw 'WinRT AsTask(IAsyncOperation) was not found' }
  $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  [void]$task.Wait()
  return $task.Result
}

function Start-WinRtTone {
  param([string]$Path, [int]$WaitSeconds)
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Playback.MediaPlayer, Windows.Media, ContentType = WindowsRuntime]
  $null = [Windows.Media.Core.MediaSource, Windows.Media, ContentType = WindowsRuntime]
  $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
  $player = [Windows.Media.Playback.MediaPlayer]::new()
  $player.Source = [Windows.Media.Core.MediaSource]::CreateFromStorageFile($file)
  $player.Play()
  $hold = if ($WaitSeconds -gt 0) { $WaitSeconds } else { $ToneSeconds }
  Start-Sleep -Seconds $hold
  $player.Pause()
  $player.Dispose()
}

if (-not (Test-Path -LiteralPath $WavPath) -or $Generate) {
  Write-TestTone -Path $WavPath -DurationSeconds $ToneSeconds -Rate $SampleRate
}
if ($Generate) {
  Write-Output $WavPath
  return
}

$wmplayer = Find-Wmplayer
if ($wmplayer) {
  $proc = Start-Process -FilePath $wmplayer -ArgumentList @('/play', '/close', $WavPath) -PassThru
  if ($Seconds -gt 0) {
    Start-Sleep -Seconds $Seconds
    if (-not $proc.HasExited) {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
  } else {
    $proc.WaitForExit()
  }
  Write-Output "played test tone via Windows Media Player pid=$($proc.Id)"
  return
}

try {
  Start-WinRtTone -Path $WavPath -WaitSeconds $Seconds
  Write-Output "played test tone via WinRT MediaPlayer (GSMTC)"
} catch {
  Write-Error "Windows Media Player is not installed and WinRT playback failed: $($_.Exception.Message)"
  exit 1
}
