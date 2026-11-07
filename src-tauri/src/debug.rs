use serde::Serialize;
use tauri::State;

use crate::events::FioreEvent;
use crate::hub::HubHandle;

#[derive(Debug, thiserror::Error)]
pub enum DebugError {
    #[error("hub channel closed")]
    Closed,
    #[error("invalid event line")]
    InvalidLine,
}

impl Serialize for DebugError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub fn inject(hub: &HubHandle, event: FioreEvent) {
    if let Err(err) = hub.send_event(event) {
        tracing::debug!(error = %err, "dropped debug event");
    }
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn emit_debug_event(event: FioreEvent, hub: State<'_, HubHandle>) -> Result<(), DebugError> {
    hub.send_event(event).map_err(|_| DebugError::Closed)
}

#[cfg(debug_assertions)]
pub fn debug_bind_addr(port: u16) -> std::net::SocketAddr {
    std::net::SocketAddr::from(([127, 0, 0, 1], port))
}

#[cfg(debug_assertions)]
fn dev_port() -> u16 {
    std::env::var("FIORE_DEV_PORT")
        .ok()
        .and_then(|raw| raw.parse().ok())
        .unwrap_or(17321)
}

#[cfg(debug_assertions)]
pub fn parse_debug_line(line: &str) -> Result<FioreEvent, DebugError> {
    serde_json::from_str(line.trim()).map_err(|_| DebugError::InvalidLine)
}

#[cfg(debug_assertions)]
pub fn spawn_listener(hub: HubHandle) {
    let port = dev_port();
    let addr = debug_bind_addr(port);
    let _ = std::thread::Builder::new()
        .name("fiore-debug".to_string())
        .spawn(move || {
            let listener = match std::net::TcpListener::bind(addr) {
                Ok(listener) => listener,
                Err(err) => {
                    tracing::warn!(error = %err, port, "debug listener bind failed");
                    return;
                }
            };
            for conn in listener.incoming() {
                match conn {
                    Ok(stream) => serve(hub.clone(), stream),
                    Err(err) => tracing::debug!(error = %err, "debug accept failed"),
                }
            }
        });
}

#[cfg(debug_assertions)]
fn serve(hub: HubHandle, stream: std::net::TcpStream) {
    use std::io::{BufRead, BufReader};

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => match parse_debug_line(&line) {
                Ok(event) => inject(&hub, event),
                Err(err) => tracing::debug!(error = %err, "skipped debug line"),
            },
            Err(err) => {
                tracing::debug!(error = %err, "debug connection read failed");
                break;
            }
        }
    }
}

#[cfg(all(test, debug_assertions))]
mod tests {
    // Socket setup and JSON fixtures use unwrap as the assertion.
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    #[test]
    fn parses_valid_invalid_and_unknown_lines() {
        let ok = parse_debug_line(r#"{"type":"music.stopped","payload":{}}"#).unwrap();
        assert!(matches!(ok, FioreEvent::MusicStopped {}));
        assert!(parse_debug_line("not-json").is_err());
        assert!(parse_debug_line(r#"{"type":"no.such","payload":{}}"#).is_err());
    }

    #[test]
    fn listener_binds_loopback_only() {
        let listener = std::net::TcpListener::bind(debug_bind_addr(0)).unwrap();
        let addr = listener.local_addr().unwrap();
        assert!(addr.ip().is_loopback());
        assert_eq!(debug_bind_addr(17321).ip().to_string(), "127.0.0.1");
    }
}
