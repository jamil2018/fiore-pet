mod debug;
mod events;
mod hub;
mod logging;
mod sensors;
mod window;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(err) = logging::init() {
        tracing::error!(error = %err, "logging init failed");
    }

    let builder = tauri::Builder::default();
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    let builder = builder.plugin(window::single_instance_plugin());

    let builder = builder.setup(|app| {
        window::setup(app)?;
        hub::start(app.handle(), sensors::all())?;
        #[cfg(debug_assertions)]
        {
            let handle = app.state::<hub::HubHandle>().inner().clone();
            debug::spawn_listener(handle);
        }
        Ok(())
    });

    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        hub::frontend_ready,
        debug::emit_debug_event
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![hub::frontend_ready]);

    if let Err(err) = builder.run(tauri::generate_context!()) {
        tracing::error!(error = %err, "tauri run failed");
        std::process::exit(1);
    }
}
