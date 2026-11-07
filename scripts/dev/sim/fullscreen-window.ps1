# Borderless window covering the primary monitor, no caption, until Esc.
# The fullscreen sensor treats a foreground window that covers rcMonitor and has
# no caption as fullscreen. DPI-aware so the rect is in physical pixels.
[CmdletBinding()]
param()

Set-StrictMode -Version 2.0

if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
  & powershell.exe -NoProfile -STA -File $PSCommandPath
  exit $LASTEXITCODE
}

if (-not ('FioreDpi' -as [type])) {
  Add-Type @"
using System.Runtime.InteropServices;
public static class FioreDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
}

[void][FioreDpi]::SetProcessDPIAware()

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Bounds = $bounds
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::Black
$form.KeyPreview = $true
$form.Text = 'Fiore fullscreen sim'
$form.Add_KeyDown({
  if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    $form.Close()
  }
})

$label = New-Object System.Windows.Forms.Label
$label.Text = 'Fiore fullscreen sim - press Esc to close'
$label.ForeColor = [System.Drawing.Color]::White
$label.BackColor = [System.Drawing.Color]::Black
$label.AutoSize = $true
$label.Location = New-Object System.Drawing.Point(24, 24)
$form.Controls.Add($label)

Write-Output "fullscreen window on primary monitor ($($bounds.Width)x$($bounds.Height), no caption). Esc closes it."
[System.Windows.Forms.Application]::Run($form)
