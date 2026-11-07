use std::sync::mpsc::Sender;

use crate::events::FioreEvent;
use crate::sensors::{Sensor, SensorError};

pub struct FullscreenSensor;

impl Sensor for FullscreenSensor {
    fn name(&self) -> &'static str {
        "fullscreen"
    }

    fn start(&self, _tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        tracing::debug!(sensor = "fullscreen", "stub");
        Ok(())
    }
}
