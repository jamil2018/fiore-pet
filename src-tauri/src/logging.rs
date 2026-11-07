#[derive(Debug, thiserror::Error)]
pub enum LoggingError {
    // Constructed once logging can fail. The W1.0 stub always returns Ok.
    #[allow(dead_code)]
    #[error("logging init failed: {0}")]
    Init(String),
}

pub fn init() -> Result<(), LoggingError> {
    Ok(())
}
