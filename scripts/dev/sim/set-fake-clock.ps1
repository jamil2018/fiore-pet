<#
.SYNOPSIS
  Set FIORE_FAKE_CLOCK to an ISO local time (no offset) for a mood, season, or boundary.

.DESCRIPTION
  The clock sensor reads FIORE_FAKE_CLOCK (docs/fiore-mvp-spec.md). Dot-source this
  script so the variable stays in the caller:
    . .\scripts\dev\sim\set-fake-clock.ps1 -Mood sleepy
    . .\scripts\dev\sim\set-fake-clock.ps1 -Season winter
    . .\scripts\dev\sim\set-fake-clock.ps1 -Boundary 05:00
    . .\scripts\dev\sim\set-fake-clock.ps1 -List

  Mood-only times use 2026-06-15. Season-only times use 12:00:00 (content).
  Pass both to combine the season's date with the mood's time of day.
#>
[CmdletBinding()]
param(
  [ValidateSet('energetic', 'content', 'calm', 'sleepy')]
  [string]$Mood,
  [ValidateSet('winter', 'spring', 'summer', 'autumn')]
  [string]$Season,
  [ValidateSet('04:59', '05:00', '10:59', '11:00', '17:00', '21:00', 'nov30', 'dec1', 'feb28', 'feb29', 'mar1', 'aug31', 'sep1')]
  [string]$Boundary,
  [string]$At,
  [switch]$List
)

Set-StrictMode -Version 2.0

$MoodHour = @{
  energetic = '08:00:00'
  content   = '12:00:00'
  calm      = '18:00:00'
  sleepy    = '22:00:00'
}
$SeasonDate = @{
  winter = '2026-01-15'
  spring = '2026-04-15'
  summer = '2026-07-15'
  autumn = '2026-10-15'
}
$BoundaryAt = @{
  '04:59' = '2026-06-15T04:59:00'
  '05:00' = '2026-06-15T05:00:00'
  '10:59' = '2026-06-15T10:59:00'
  '11:00' = '2026-06-15T11:00:00'
  '17:00' = '2026-06-15T17:00:00'
  '21:00' = '2026-06-15T21:00:00'
  'nov30' = '2026-11-30T12:00:00'
  'dec1'  = '2026-12-01T12:00:00'
  'feb28' = '2026-02-28T12:00:00'
  'feb29' = '2028-02-29T12:00:00'
  'mar1'  = '2026-03-01T12:00:00'
  'aug31' = '2026-08-31T12:00:00'
  'sep1'  = '2026-09-01T12:00:00'
}

function Get-FioreFakeClock {
  param([string]$MoodName, [string]$SeasonName)
  $date = if ($SeasonName) { $SeasonDate[$SeasonName] } else { '2026-06-15' }
  $time = if ($MoodName) { $MoodHour[$MoodName] } else { '12:00:00' }
  return "${date}T${time}"
}

if ($List) {
  foreach ($name in @('energetic', 'content', 'calm', 'sleepy')) {
    Write-Output ("mood {0} {1}" -f $name, (Get-FioreFakeClock -MoodName $name -SeasonName ''))
  }
  foreach ($name in @('winter', 'spring', 'summer', 'autumn')) {
    Write-Output ("season {0} {1}" -f $name, (Get-FioreFakeClock -MoodName '' -SeasonName $name))
  }
  foreach ($name in @('04:59', '05:00', '10:59', '11:00', '17:00', '21:00', 'nov30', 'dec1', 'feb28', 'feb29', 'mar1', 'aug31', 'sep1')) {
    Write-Output ("boundary {0} {1}" -f $name, $BoundaryAt[$name])
  }
  return
}

$stamp = $null
if ($At) {
  if ($At -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$') {
    Write-Error "FIORE_FAKE_CLOCK must look like yyyy-MM-ddTHH:mm:ss"
    exit 2
  }
  $stamp = $At
} elseif ($Boundary) {
  $stamp = $BoundaryAt[$Boundary]
} elseif ($Mood -or $Season) {
  $stamp = Get-FioreFakeClock -MoodName $Mood -SeasonName $Season
} else {
  Write-Error "usage: . .\scripts\dev\sim\set-fake-clock.ps1 -Mood energetic | -Season winter | -Boundary 05:00 | -At yyyy-MM-ddTHH:mm:ss | -List"
  exit 2
}

$env:FIORE_FAKE_CLOCK = $stamp
Write-Output "FIORE_FAKE_CLOCK=$stamp"
