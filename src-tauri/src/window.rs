use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, LogicalPosition, Manager, Runtime, WebviewWindow};

mod autostart;

pub const MAIN_LABEL: &str = "main";
const SHOW_ID: &str = "show";
const HIDE_ID: &str = "hide";
const AUTOSTART_ID: &str = "autostart";
const QUIT_ID: &str = "quit";
#[cfg(target_os = "macos")]
const AUTOSTART_LABEL: &str = "Start at login";
#[cfg(not(target_os = "macos"))]
const AUTOSTART_LABEL: &str = "Start with Windows";

/// Inset from the work-area edges when the pet is first placed, in logical pixels.
pub const EDGE_MARGIN_PX: i32 = 16;

/// Configured pet window (96px sprite plus bubble margin) when the webview has not reported a size.
const FALLBACK_WINDOW_PX: (u32, u32) = (160, 136);

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum WindowError {
    #[error("window setup failed: {0}")]
    Setup(String),
}

/// A rectangle in logical pixels. Origins may be negative on multi-monitor desktops.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Convert a physical-pixel rectangle to logical pixels (`physical / scale`), rounding to integers.
pub fn physical_to_logical(area: WorkArea, scale: f64) -> Result<WorkArea, WindowError> {
    if !scale.is_finite() || scale <= 0.0 {
        return Err(WindowError::Setup(format!("invalid scale factor {scale}")));
    }
    Ok(WorkArea {
        x: round_i32(area.x as f64 / scale)?,
        y: round_i32(area.y as f64 / scale)?,
        width: round_u32(area.width as f64 / scale)?,
        height: round_u32(area.height as f64 / scale)?,
    })
}

/// Keep the pet window inside `area`. A window larger than the area is pinned to the origin corner.
pub fn clamp_position(x: i32, y: i32, area: WorkArea, window_w: u32, window_h: u32) -> (i32, i32) {
    let (min_x, max_x) = axis_bounds(area.x, area.width, window_w);
    let (min_y, max_y) = axis_bounds(area.y, area.height, window_h);
    (x.clamp(min_x, max_x), y.clamp(min_y, max_y))
}

/// Bottom-right of the work area, inset by `margin` logical pixels, then clamped inside it.
pub fn bottom_right(area: WorkArea, window_w: u32, window_h: u32, margin: i32) -> (i32, i32) {
    let inset = margin.max(0);
    let x = area
        .x
        .saturating_add(as_i32(area.width))
        .saturating_sub(as_i32(window_w))
        .saturating_sub(inset);
    let y = area
        .y
        .saturating_add(as_i32(area.height))
        .saturating_sub(as_i32(window_h))
        .saturating_sub(inset);
    clamp_position(x, y, area, window_w, window_h)
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub fn single_instance_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // Show, rather than focus: the pet is created unfocused and may be hidden.
        report(show_main(app));
    })
}

pub fn setup<R: Runtime>(app: &mut App<R>) -> Result<(), WindowError> {
    let window = main_window(app.handle())?;
    // Leave the window hidden. The frontend calls show() after the first frame
    // so a transparent window does not flash white.
    if let Err(err) = place_window(&window) {
        tracing::warn!(error = %err, "initial window position skipped");
    }
    let autostart_ready = register_autostart(app);
    install_tray(app, autostart_ready)?;
    Ok(())
}

fn register_autostart<R: Runtime>(app: &mut App<R>) -> bool {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        match app.handle().plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        )) {
            Ok(()) => true,
            Err(err) => {
                tracing::warn!(error = %err, "autostart plugin init failed");
                false
            }
        }
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = app;
        false
    }
}

fn place_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), WindowError> {
    let monitor = window
        .primary_monitor()
        .map_err(to_setup)?
        .ok_or_else(|| WindowError::Setup("no primary monitor".to_string()))?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let logical = physical_to_logical(
        WorkArea {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        },
        scale,
    )?;
    let outer = window.outer_size().map_err(to_setup)?;
    let (window_w, window_h) = logical_window_size(outer.width, outer.height, scale)?;
    let (x, y) = bottom_right(logical, window_w, window_h, EDGE_MARGIN_PX);
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(to_setup)
}

fn logical_window_size(width: u32, height: u32, scale: f64) -> Result<(u32, u32), WindowError> {
    let logical = physical_to_logical(
        WorkArea {
            x: 0,
            y: 0,
            width,
            height,
        },
        scale,
    )?;
    if logical.width == 0 || logical.height == 0 {
        return Ok(FALLBACK_WINDOW_PX);
    }
    Ok((logical.width, logical.height))
}

fn install_tray<R: Runtime>(app: &App<R>, autostart_ready: bool) -> Result<(), WindowError> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| WindowError::Setup("missing window icon".to_string()))?;
    let show = MenuItem::with_id(app, SHOW_ID, "Show", true, None::<&str>).map_err(to_setup)?;
    let hide = MenuItem::with_id(app, HIDE_ID, "Hide", true, None::<&str>).map_err(to_setup)?;
    let autostart_checked = autostart_ready && autostart_is_enabled(app);
    let autostart = CheckMenuItem::with_id(
        app,
        AUTOSTART_ID,
        AUTOSTART_LABEL,
        autostart_ready,
        autostart_checked,
        None::<&str>,
    )
    .map_err(to_setup)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>).map_err(to_setup)?;
    let menu = Menu::with_items(app, &[&show, &hide, &autostart, &quit]).map_err(to_setup)?;
    #[cfg(target_os = "macos")]
    let (audio_item, browser_items) = {
        use crate::sensors::macos;
        let titles = MenuItem::with_id(
            app,
            "mac_titles",
            "Allow window title detection…",
            true,
            None::<&str>,
        )
        .map_err(to_setup)?;
        let music = MenuItem::with_id(
            app,
            "mac_music",
            "Allow Apple Music reactions…",
            true,
            None::<&str>,
        )
        .map_err(to_setup)?;
        let spotify = MenuItem::with_id(
            app,
            "mac_spotify",
            "Allow Spotify reactions…",
            true,
            None::<&str>,
        )
        .map_err(to_setup)?;
        let audio = CheckMenuItem::with_id(
            app,
            "mac_audio",
            "Audio volume reactions (macOS 14.2+)",
            macos::audio_supported(),
            macos::audio_enabled(),
            None::<&str>,
        )
        .map_err(to_setup)?;
        let permissions = tauri::menu::Submenu::with_items(
            app,
            "Reactions & permissions",
            true,
            &[&titles, &music, &spotify, &audio],
        )
        .map_err(to_setup)?;
        let browsers = tauri::menu::Submenu::new(app, "Browser media", true).map_err(to_setup)?;
        let mut items = Vec::new();
        for (index, label) in [
            "Chrome media…",
            "Safari media…",
            "Edge media…",
            "Brave media…",
        ]
        .into_iter()
        .enumerate()
        {
            let index = index as i32;
            let id = format!("mac_browser_{index}");
            let item = CheckMenuItem::with_id(
                app,
                id.clone(),
                label,
                true,
                macos::browser_enabled(index),
                None::<&str>,
            )
            .map_err(to_setup)?;
            browsers.append(&item).map_err(to_setup)?;
            items.push((id, index, item));
        }
        permissions.append(&browsers).map_err(to_setup)?;
        menu.insert(&permissions, 3).map_err(to_setup)?;
        (audio, items)
    };
    let autostart_item = autostart.clone();
    let tray = TrayIconBuilder::<R>::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Fiore")
        .show_menu_on_left_click(true)
        .on_menu_event(move |handle, event| match event.id.as_ref() {
            SHOW_ID => report(show_main(handle)),
            HIDE_ID => report(hide_main(handle)),
            AUTOSTART_ID => on_autostart_click(handle, &autostart_item),
            #[cfg(target_os = "macos")]
            "mac_titles" => crate::sensors::macos::request_accessibility(),
            #[cfg(target_os = "macos")]
            "mac_music" => crate::sensors::macos::request_media(0),
            #[cfg(target_os = "macos")]
            "mac_spotify" => crate::sensors::macos::request_media(1),
            #[cfg(target_os = "macos")]
            "mac_audio" => {
                let enabled = crate::sensors::macos::toggle_audio();
                if let Err(error) = audio_item.set_checked(enabled) {
                    tracing::warn!(%error, "audio menu sync failed");
                }
            }
            #[cfg(target_os = "macos")]
            id if id.starts_with("mac_browser_") => {
                if let Some((_, index, item)) = browser_items.iter().find(|(key, _, _)| key == id) {
                    let enabled = crate::sensors::macos::toggle_browser(*index);
                    if let Err(error) = item.set_checked(enabled) {
                        tracing::warn!(%error, "browser menu sync failed");
                    }
                }
            }
            QUIT_ID => handle.exit(0),
            _ => {}
        })
        .build(app)
        .map_err(to_setup)?;
    // Dropping the last TrayIcon removes it from the system tray.
    // CheckMenuItem is Clone (docs.rs tauri 2.12.5); the closure plus managed state keep it.
    app.manage(tray);
    app.manage(autostart);
    Ok(())
}

fn autostart_is_enabled<R: Runtime>(app: &App<R>) -> bool {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        autostart::checked_app(app.handle())
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = app;
        false
    }
}

fn on_autostart_click<R: Runtime>(handle: &AppHandle<R>, item: &CheckMenuItem<R>) {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let actual = match autostart::toggle_app(handle) {
            Ok(enabled) => enabled,
            Err(err) => {
                tracing::warn!(error = %err, "autostart toggle failed");
                autostart::checked_app(handle)
            }
        };
        if let Err(err) = item.set_checked(actual) {
            tracing::warn!(error = %err, "autostart check sync failed");
        }
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = (handle, item);
    }
}

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, WindowError> {
    app.get_webview_window(MAIN_LABEL)
        .ok_or_else(|| WindowError::Setup(format!("missing window {MAIN_LABEL}")))
}

fn show_main<R: Runtime>(app: &AppHandle<R>) -> Result<(), WindowError> {
    main_window(app)?.show().map_err(to_setup)
}

fn hide_main<R: Runtime>(app: &AppHandle<R>) -> Result<(), WindowError> {
    main_window(app)?.hide().map_err(to_setup)
}

fn report(result: Result<(), WindowError>) {
    if let Err(err) = result {
        tracing::warn!(error = %err, "window visibility change failed");
    }
}

fn to_setup(err: impl std::fmt::Display) -> WindowError {
    WindowError::Setup(err.to_string())
}

fn axis_bounds(origin: i32, span: u32, window: u32) -> (i32, i32) {
    let far = origin
        .saturating_add(as_i32(span))
        .saturating_sub(as_i32(window));
    if origin <= far {
        (origin, far)
    } else {
        (far, origin)
    }
}

fn as_i32(value: u32) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

fn round_i32(value: f64) -> Result<i32, WindowError> {
    if !value.is_finite() {
        return Err(WindowError::Setup(format!("invalid coordinate {value}")));
    }
    let rounded = value.round();
    let bounds = (i32::MIN as f64)..=(i32::MAX as f64);
    if !bounds.contains(&rounded) {
        return Err(WindowError::Setup(format!(
            "coordinate out of range {value}"
        )));
    }
    Ok(rounded as i32)
}

fn round_u32(value: f64) -> Result<u32, WindowError> {
    if !value.is_finite() || value < 0.0 {
        return Err(WindowError::Setup(format!("invalid length {value}")));
    }
    let rounded = value.round();
    if rounded >= 4_294_967_296.0 {
        return Err(WindowError::Setup(format!("length out of range {value}")));
    }
    Ok(rounded as u32)
}

#[cfg(test)]
mod tests {
    use super::{bottom_right, clamp_position, physical_to_logical, WorkArea};

    fn screen() -> WorkArea {
        WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }
    }

    #[test]
    fn bottom_right_insets_the_pet_window() {
        assert_eq!(bottom_right(screen(), 160, 136, 16), (1744, 928));
    }

    #[test]
    fn bottom_right_keeps_a_negative_monitor_origin() {
        let area = WorkArea {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert_eq!(bottom_right(area, 160, 136, 16), (-176, 928));
    }

    #[test]
    fn bottom_right_clamps_when_the_margin_exceeds_the_area() {
        let area = WorkArea {
            x: 10,
            y: 20,
            width: 160,
            height: 136,
        };
        assert_eq!(bottom_right(area, 160, 136, 16), (10, 20));
    }

    #[test]
    fn clamp_pins_an_oversized_window_to_the_origin_span() {
        let area = WorkArea {
            x: 0,
            y: 0,
            width: 100,
            height: 80,
        };
        assert_eq!(clamp_position(-60, -56, area, 160, 136), (-60, -56));
        assert_eq!(bottom_right(area, 160, 136, 0), (-60, -56));
    }

    #[test]
    fn clamp_keeps_an_interior_point() {
        assert_eq!(clamp_position(40, 50, screen(), 160, 136), (40, 50));
    }

    #[test]
    fn physical_pixels_divide_by_the_scale_factor() {
        let physical = WorkArea {
            x: 200,
            y: -100,
            width: 320,
            height: 272,
        };
        assert_eq!(
            physical_to_logical(physical, 2.0),
            Ok(WorkArea {
                x: 100,
                y: -50,
                width: 160,
                height: 136,
            })
        );
    }

    #[test]
    fn half_pixels_round_away_from_zero() {
        let physical = WorkArea {
            x: 1,
            y: -1,
            width: 5,
            height: 1,
        };
        assert_eq!(
            physical_to_logical(physical, 2.0),
            Ok(WorkArea {
                x: 1,
                y: -1,
                width: 3,
                height: 1,
            })
        );
    }

    #[test]
    fn a_bad_scale_factor_is_an_error() {
        let area = screen();
        assert!(physical_to_logical(area, 0.0).is_err());
        assert!(physical_to_logical(area, -1.0).is_err());
        assert!(physical_to_logical(area, f64::NAN).is_err());
        assert!(physical_to_logical(area, f64::INFINITY).is_err());
    }
}

/// Native start_dragging only queues the move. Wait off the UI thread for release.
/// Reads only the primary mouse button, never keyboard input or its contents.
#[tauri::command]
pub async fn wait_for_drag_release() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(any(windows, target_os = "macos"))]
        {
            use std::time::{Duration, Instant};
            let deadline = Instant::now() + Duration::from_secs(120);
            loop {
                if !primary_mouse_button_pressed() {
                    break;
                }
                if Instant::now() >= deadline {
                    return Err("mouse drag timed out".to_string());
                }
                std::thread::sleep(Duration::from_millis(30));
            }
        }
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(windows)]
fn primary_mouse_button_pressed() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    // SAFETY: valid mouse virtual-key constant; no pointers or keyboard content.
    unsafe { GetAsyncKeyState(i32::from(VK_LBUTTON.0)) < 0 }
}

#[cfg(target_os = "macos")]
fn primary_mouse_button_pressed() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
    }
    const COMBINED_SESSION_STATE: i32 = 0;
    const LEFT_BUTTON: u32 = 0;
    // SAFETY: CoreGraphics accepts these defined state/button constants; no pointers
    // or event contents are accessed, and this query is safe off the UI thread.
    unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, LEFT_BUTTON) }
}
