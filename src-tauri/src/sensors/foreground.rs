use std::sync::mpsc::Sender;

use crate::events::FioreEvent;
use crate::sensors::{Sensor, SensorError};

pub struct ForegroundSensor;

impl Sensor for ForegroundSensor {
    fn name(&self) -> &'static str {
        "foreground"
    }

    fn start(&self, _tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        tracing::debug!(sensor = "foreground", "stub");
        Ok(())
    }
}
