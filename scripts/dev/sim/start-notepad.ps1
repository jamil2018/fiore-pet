# Launches Notepad and leaves it in front so the foreground sensor can classify writing.
# The spec matches the file name notepad.exe (case-insensitive).
[CmdletBinding()]
param()

Set-StrictMode -Version 2.0

$exe = Join-Path $env:SystemRoot 'System32\notepad.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  $exe = 'notepad.exe'
}

$proc = Start-Process -FilePath $exe -PassThru
Write-Output "notepad pid=$($proc.Id) (expect category writing). Close Notepad when finished."
