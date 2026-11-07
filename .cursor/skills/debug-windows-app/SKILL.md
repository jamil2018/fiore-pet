---
name: debug-windows-app
description: Debug the Fiore Tauri/Windows app: read tracing JSON logs, run with RUST_LOG, drive events with emit-event and simulators, use mock mode, attach a debugger, and recognise common Tauri/WinRT/COM failure signatures. Use when a build, run, sensor or window misbehaves or the debugger role starts.
---

# Debug Fiore on Windows

Method (debugger role): reproduce -> up to 3 hypotheses -> prove one with a log or test -> minimal fix -> regression test -> `check fast`. Do not re-run blindly; read logs first. Report format: `docs/harness/templates/debug-report.md`.

## Logs
`tracing` writes JSON lines to `logs/fiore-dev.log` (gitignored). Read the tail, not the whole file:
```powershell
Get-Content logs/fiore-dev.log -Tail 60
Get-Content logs/fiore-dev.log -Tail 300 | Select-String '"level":"(WARN|ERROR)"'
```
Titles/track names appear only at `debug`; never paste them into reports or commits.

## Run
```powershell
$env:RUST_LOG = "debug"                       # or "<crate>=debug,warn" for one crate
npm run tauri dev                             # real app; Rust output in this terminal
npm run dev:mock                              # browser UI + fake bridge (no Rust); use the browser tool for screenshots
node scripts/dev/emit-event.mjs <event> '{"k":"v"}'   # inject a FioreEvent into the running dev app
```
Simulators for real conditions: `scripts/dev/sim/start-notepad.ps1`, `play-test-tone.ps1`, `fullscreen-window.ps1`; fake clock through the env var documented in `docs/testing.md`.

Narrow first: Rust-only bug -> `cargo test -p <crate> <name> -- --nocapture` from `src-tauri/`; frontend-only -> Vitest or mock mode; integration -> dev app + `emit-event`.

## Attach a debugger
Rust: launch `npm run tauri dev`, then attach a native debugger (VS Code with CodeLLDB or C/C++ `cppvsdbg`) to the app process: find it with `Get-Process | Where-Object ProcessName -like '*fiore*'`. Frontend: open WebView2 devtools (right-click -> Inspect in dev builds, or F12).

## Failure signatures
| Symptom | Likely cause | Fix |
|---|---|---|
| `0x800401F0` CO_E_NOTINITIALIZED | COM/WinRT used on a thread that never initialized it | initialize on the sensor's own thread before first call |
| `0x80010106` RPC_E_CHANGED_MODE | thread already in a different apartment | use the apartment mode the reference prescribes, tolerate "already initialized" |
| freeze / sensor stalls on WinRT call | blocking `.get()` on a UI/async-runtime thread | move to the sensor's dedicated thread |
| "unresolved import ... not found in module" on `windows::...` | missing `windows` crate feature | add the feature for that module path in `Cargo.toml` |
| JS call fails: "not allowed ... Permissions associated with this command" | missing capability | add the named permission in `src-tauri/capabilities/*.json` |
| `listen` never fires | event name mismatch or listener registered after emit | match `fiore://event`; register before the hub's `state.snapshot` or request snapshot |
| window white/black box | body/background not transparent | `transparent` in config and CSS |
| window shows in taskbar / loses topmost | config flags or fullscreen state | check `skipTaskbar`, `alwaysOnTop`; fullscreen hide is expected |
| `Blocking waiting for file lock on build directory` | parallel cargo in same target dir | per-worktree `CARGO_TARGET_DIR` (setup script) |
| `Access is denied` / cannot overwrite `.exe` | previous app instance still running | `Stop-Process -Name fiore -ErrorAction SilentlyContinue` |
| `Port 1420 is already in use` | stale Vite dev server | find and stop the owner: `Get-NetTCPConnection -LocalPort 1420` |
| second launch does nothing | single-instance plugin working as designed | quit the tray instance first |
| WebView2 error at startup | runtime missing/outdated | install Evergreen WebView2 runtime |
| sensor silent after one error | by design: failure disables that sensor | grep log for the `warn` that disabled it |

## Rules
Never delete or skip a test to pass; never widen scope beyond the failing path; keep the fix minimal and add a regression test. Capture the root cause as a lesson candidate (tags like `#rust #windows-api #tauri`).
