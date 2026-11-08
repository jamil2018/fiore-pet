; Autostart Run-key cleanup. Value name is `Fiore`:
; tauri-plugin-autostart uses `app.package_info().name` unless Builder::app_name is set,
; and tauri-codegen sets that name to `productName` when present (Fiore).
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Fiore"
!macroend
