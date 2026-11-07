#[derive(Debug, thiserror::Error)]
pub enum LoggingError {
    #[error("logging init failed: {0}")]
    Init(String),
}

pub fn init() -> Result<(), LoggingError> {
    Ok(())
}
