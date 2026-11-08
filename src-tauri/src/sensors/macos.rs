//! Ownership and consent boundary for the native macOS sensor adapters.
use std::ffi::{c_char, c_int, c_void, CStr};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::de::DeserializeOwned;

use super::SensorError;

static MEDIA_PERMISSION_PENDING: AtomicBool = AtomicBool::new(false);

unsafe extern "C" {
    fn fiore_macos_free(pointer: *mut c_void);
    fn fiore_macos_request_accessibility();
    fn fiore_macos_request_media_permission(player: c_int) -> c_int;
    fn fiore_macos_audio_enabled() -> c_int;
    fn fiore_macos_set_audio_enabled(enabled: c_int);
    fn fiore_macos_audio_supported() -> c_int;
    fn fiore_macos_show_message(message: *const c_char);
}

struct OwnedSnapshot(*mut c_char);

impl Drop for OwnedSnapshot {
    fn drop(&mut self) {
        // SAFETY: this guard uniquely owns the malloc allocation returned by the bridge.
        unsafe { fiore_macos_free(self.0.cast()) };
    }
}

/// Consume one NUL-terminated malloc allocation returned by a native snapshot function.
/// Callers must supply only bridge-owned pointers, never arbitrary Rust buffers.
pub(super) fn snapshot<T: DeserializeOwned>(pointer: *mut c_char) -> Result<T, SensorError> {
    if pointer.is_null() {
        return Err(SensorError::Failed(
            "macOS snapshot allocation failed".into(),
        ));
    }
    let owned = OwnedSnapshot(pointer);
    // SAFETY: native snapshots return a live NUL-terminated allocation; the guard frees it afterwards.
    let json = unsafe { CStr::from_ptr(owned.0) }.to_bytes();
    // Do not include serde's error: it can contain private window/track text.
    serde_json::from_slice(json).map_err(|_| SensorError::Failed("invalid macOS snapshot".into()))
}

pub(crate) fn request_accessibility() {
    // SAFETY: no arguments; the native function owns its permission UI and contains exceptions.
    unsafe { fiore_macos_request_accessibility() };
}

pub(crate) fn request_media(player: i32) {
    if MEDIA_PERMISSION_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    // Permission dialogs can block; never make the Tauri main thread wait for Apple Events.
    let result = std::thread::Builder::new()
        .name("mac-media-permission".into())
        .spawn(move || {
            // SAFETY: tray supplies only player 0 or 1, and native code validates the index.
            let status = unsafe { fiore_macos_request_media_permission(player) };
            MEDIA_PERMISSION_PENDING.store(false, Ordering::Release);
            let message = match status {
                0 => c"Music permission is enabled. Play a track in the selected app to see Fiore react.",
                1 => c"Open the selected music app, then choose this permission action again. Fiore never opens players for you.",
                2 => c"Music access was not granted. You can enable Fiore in System Settings > Privacy & Security > Automation.",
                _ => c"Music permission could not be checked. Try again while the selected player is open.",
            };
            // SAFETY: message is a static NUL-terminated C string, copied before native dispatch returns.
            unsafe { fiore_macos_show_message(message.as_ptr()) };
        });
    if let Err(error) = result {
        MEDIA_PERMISSION_PENDING.store(false, Ordering::Release);
        tracing::warn!(%error, "could not start music permission request");
    }
}

pub(crate) fn audio_supported() -> bool {
    // SAFETY: no arguments; availability query does not open an audio device.
    unsafe { fiore_macos_audio_supported() != 0 }
}

pub(crate) fn audio_enabled() -> bool {
    // SAFETY: no arguments; native preference reads are thread-safe.
    unsafe { fiore_macos_audio_enabled() != 0 }
}

pub(crate) fn toggle_audio() -> bool {
    let enabled = audio_supported() && !audio_enabled();
    // SAFETY: boolean converted to the documented 0/1 ABI; native preference writes are thread-safe.
    unsafe { fiore_macos_set_audio_enabled(i32::from(enabled)) };
    if enabled {
        // SAFETY: static NUL-terminated message is copied synchronously by the bridge.
        unsafe {
            fiore_macos_show_message(c"Audio reactions are enabled. When music plays, macOS may ask for System Audio Recording access. Fiore measures volume only and never saves audio or uses your microphone. You can turn this off from the tray.".as_ptr())
        };
    }
    enabled
}
