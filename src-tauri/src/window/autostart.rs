//! Tray-backed autostart toggle. OS work sits behind [`Launcher`].

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AutostartError {
    #[error("autostart query failed: {0}")]
    Query(String),
    #[error("autostart enable failed: {0}")]
    Enable(String),
    #[error("autostart disable failed: {0}")]
    Disable(String),
}

pub trait Launcher {
    fn is_enabled(&self) -> Result<bool, AutostartError>;
    fn enable(&self) -> Result<(), AutostartError>;
    fn disable(&self) -> Result<(), AutostartError>;
}

/// Flip autostart and return the new real state. On error the previous state is unchanged.
pub fn toggle(launcher: &impl Launcher) -> Result<bool, AutostartError> {
    if launcher.is_enabled()? {
        launcher.disable()?;
        Ok(false)
    } else {
        launcher.enable()?;
        Ok(true)
    }
}

/// Tray check mark: a query error is treated as unchecked.
pub fn checked(launcher: &impl Launcher) -> bool {
    launcher.is_enabled().unwrap_or(false)
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
impl Launcher for tauri_plugin_autostart::AutoLaunchManager {
    fn is_enabled(&self) -> Result<bool, AutostartError> {
        plugin_is_enabled(self)
    }

    fn enable(&self) -> Result<(), AutostartError> {
        plugin_enable(self)
    }

    fn disable(&self) -> Result<(), AutostartError> {
        plugin_disable(self)
    }
}

// Inherent AutoLaunchManager methods, called from free functions so the trait impl
// cannot recurse into Launcher.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
fn plugin_is_enabled(
    manager: &tauri_plugin_autostart::AutoLaunchManager,
) -> Result<bool, AutostartError> {
    manager
        .is_enabled()
        .map_err(|err| AutostartError::Query(err.to_string()))
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
fn plugin_enable(
    manager: &tauri_plugin_autostart::AutoLaunchManager,
) -> Result<(), AutostartError> {
    manager
        .enable()
        .map_err(|err| AutostartError::Enable(err.to_string()))
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
fn plugin_disable(
    manager: &tauri_plugin_autostart::AutoLaunchManager,
) -> Result<(), AutostartError> {
    manager
        .disable()
        .map_err(|err| AutostartError::Disable(err.to_string()))
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub fn toggle_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<bool, AutostartError> {
    use tauri_plugin_autostart::ManagerExt;
    toggle(&*app.autolaunch())
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub fn checked_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    checked(&*app.autolaunch())
}

#[cfg(test)]
mod tests {
    use super::{checked, toggle, AutostartError, Launcher};
    use std::cell::Cell;

    struct Fake {
        enabled: Cell<bool>,
        enable_err: bool,
        disable_err: bool,
        query_err: bool,
    }

    impl Fake {
        fn off() -> Self {
            Self {
                enabled: Cell::new(false),
                enable_err: false,
                disable_err: false,
                query_err: false,
            }
        }

        fn on() -> Self {
            Self {
                enabled: Cell::new(true),
                enable_err: false,
                disable_err: false,
                query_err: false,
            }
        }
    }

    impl Launcher for Fake {
        fn is_enabled(&self) -> Result<bool, AutostartError> {
            if self.query_err {
                Err(AutostartError::Query("query".into()))
            } else {
                Ok(self.enabled.get())
            }
        }

        fn enable(&self) -> Result<(), AutostartError> {
            if self.enable_err {
                Err(AutostartError::Enable("enable".into()))
            } else {
                self.enabled.set(true);
                Ok(())
            }
        }

        fn disable(&self) -> Result<(), AutostartError> {
            if self.disable_err {
                Err(AutostartError::Disable("disable".into()))
            } else {
                self.enabled.set(false);
                Ok(())
            }
        }
    }

    #[test]
    fn toggle_off_to_on() {
        let fake = Fake::off();
        assert_eq!(toggle(&fake), Ok(true));
        assert!(fake.enabled.get());
    }

    #[test]
    fn toggle_on_to_off() {
        let fake = Fake::on();
        assert_eq!(toggle(&fake), Ok(false));
        assert!(!fake.enabled.get());
    }

    #[test]
    fn enable_error_leaves_state_unchanged() {
        let fake = Fake {
            enable_err: true,
            ..Fake::off()
        };
        assert_eq!(toggle(&fake), Err(AutostartError::Enable("enable".into())));
        assert!(!fake.enabled.get());
    }

    #[test]
    fn is_enabled_error_reads_as_unchecked() {
        let fake = Fake {
            enabled: Cell::new(true),
            query_err: true,
            ..Fake::off()
        };
        assert!(!checked(&fake));
    }
}
