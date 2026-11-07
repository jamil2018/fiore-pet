#[derive(Debug, thiserror::Error)]
pub enum WindowError {
    #[error("window setup failed: {0}")]
    Setup(String),
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub fn single_instance_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_single_instance::init(|_app, _args, _cwd| {})
}

pub fn setup<R: tauri::Runtime>(app: &mut tauri::App<R>) -> Result<(), WindowError> {
    let _ = app;
    Ok(())
}
