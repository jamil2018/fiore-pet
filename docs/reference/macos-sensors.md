# macOS sensors

Purpose: public API boundaries, permission setup and manual verification for the development Mac sensor implementation.
last-verified: 2026-11-08

Platform behavior and events are owned by [the spec](../fiore-mvp-spec.md); packaging and signing by [the release guide](../releasing.md). These changes are not in the published v0.2.0 preview.

## Setup

Use the tray's **Reactions & permissions** submenu. App category detection works without consent. **Allow window title detection…** requests Accessibility access; grant Fiore access in System Settings → Privacy & Security → Accessibility if you want browser writing-title rules. This reads only the focused window title, never text fields or keystrokes.

Development bundles require macOS 10.15 or newer. Audio-volume metering has the higher requirement below.

Open Apple Music or Spotify, then choose its **Allow … reactions…** item. Approve the Automation request. Fiore never launches players. If access was denied, change it under Privacy & Security → Automation. Playback and song banners work with either authorized player; the selected player stays selected while playing when both are active.

For browser players, open your browser and select it under **Reactions & permissions → Browser media**. Approve Automation, then manually enable **Allow JavaScript from Apple Events** in the browser: Chrome uses View → Developer; Safari exposes it in its developer settings (enable features for web developers first). Fiore never changes this setting for you. Chrome and Safari have public scripting interfaces; Edge and Brave use the Chromium adapter and still need live compatibility checks. Uncheck a browser's media item to disable its polling. If it was closed when enabled, open it and toggle the item off/on to request consent.

The fixed probe reads only Media Session title/artist/playback state and audio/video playback properties. It checks a selected playing tab first and scans other tabs in bounded batches, so background discovery can take longer with many tabs. Native Music/Spotify playback takes precedence. Websites that do not provide song metadata show a generic browser-audio label. Firefox, WebAudio-only players without Media Session state and cross-origin iframe players without top-level state are not covered by this adapter. Browser setup failures leave native player reactions available.

**Audio volume reactions (macOS 14.2+)** is off by default and saved between runs. Enable it to let music intensity affect motion. When a supported player plays, macOS may request System Audio Recording access. Fiore reduces system output to a volume scalar; it never captures the microphone, writes recordings or sends audio anywhere. If denied, grant access in Privacy & Security, then toggle the option off/on. Playback animations still work without volume permission. The menu is disabled on older systems.

## Native boundaries

- [NSWorkspace.frontmostApplication](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication) supplies app identity. Bundle identifiers map through the shared category resource. Optional AX focused-window title reads use bounded messaging timeouts.
- [CGWindowListCopyWindowInfo](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:)) provides onscreen bounds and owner PID; no screenshots or Screen Recording permission are requested for window detection. Only ordinary windows belonging to the foreground app are candidates. Display coordinates support secondary monitors and negative origins. Optional AX fullscreen hints augment geometry; missing/unknown readings preserve the last state. Geometry can confuse a borderless maximized window with fullscreen when menu bar/Dock are auto-hidden.
- [ScriptingBridge](https://developer.apple.com/documentation/scriptingbridge) uses PID-addressed, read-only Music/Spotify properties. [Apple Events permission preflight](https://developer.apple.com/documentation/coreservices/3025784-aedeterminepermissiontoautomatet) never prompts from the polling path. Requests have short timeouts. No private MediaRemote API or entitlement bypass is used.
- Browser probes use Chromium's [public scripting dictionary](https://chromium.googlesource.com/chromium/src.git/+/lkgr/chrome/browser/ui/cocoa/applescript/scripting.sdef) and Safari's [Apple Events JavaScript setting](https://developer.apple.com/documentation/safari-developer-tools/developer-settings). Media metadata follows the [Media Session specification](https://www.w3.org/TR/mediasession/). No browser extension or listening network service is installed. CI checks the installed Safari scripting declaration and Chrome's when available.
- [Core Audio process taps](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps) require macOS 14.2+. The private aggregate is unmuted and never changes the system default device. The realtime callback computes a finite peak only; control-worker code owns allocation, device changes and cleanup. Capture failure requires explicit re-enablement to retry consent.

Native strings are malloc-owned and freed by the Rust adapter, including decode errors. Native exceptions do not cross FFI. Error logs omit private titles and tracks. The bridge is compiled with ARC using the host Xcode SDK, guarded at runtime for newer APIs.

## Manual Mac acceptance (requires an interactive Mac)

Native CI compilation, unit tests, universal architectures and bundle signature checks do not validate permission dialogs or hardware capture. Before declaring runtime parity:

1. Fresh install, permissions unset: launch without prompts. Switch Safari, VS Code, TextEdit and an unknown app; verify the category hold and the pet stays put. Pet focus must not clear the activity.
2. Grant/deny/revoke Accessibility. Verify Google Docs title rules only when authorized, with no text-field content reads or crash on an unresponsive app.
3. Enter/exit native fullscreen, borderless fullscreen and maximized windows on each monitor, including a display left of the primary. Switch Spaces, close the focused window and disconnect a display. Verify hide/appear and recovery without false pet-self detection.
4. Music and Spotify separately: absent, open/paused, play, change song, pause shorter/longer than two seconds, quit. Test both simultaneously, switch the active player, deny/regrant Automation and force an unresponsive player. Verify no launches and no stuck headphones.
5. Leave audio reactions off: no audio permission prompt. Enable while playing and grant/deny; test silent/loud output, pause, headphone/Bluetooth device changes, sleep/wake and permission revocation. Disable while playing: meter closes and levels stop. No microphone indicator or recording files should appear.
6. Repeat music plus coding/browsing, dragging, petting and fullscreen. Confirm existing priority and banner behavior. Quit cleanly; check idle CPU and memory against the spec.
7. For each enabled browser: approve/deny Automation; leave JavaScript-from-Apple-Events disabled, then enable it; play/pause/change a song in a background tab, reorder/close/navigate tabs and switch windows. Verify muted/paused HTML media does not trigger playback, absent metadata stays generic, native music preempts browser music, and disabling one browser does not stop another active source. Check videos and music pages that actually expose Media Session or HTML media; record site/browser gaps rather than claiming universal support.

The actual fixed JavaScript probe has deterministic regression tests: `node --test src-tauri/native/macos/browser_probe.test.mjs`.
