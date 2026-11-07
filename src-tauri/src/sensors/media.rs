use std::sync::mpsc::Sender;

use crate::events::FioreEvent;
use crate::sensors::{Sensor, SensorError};

pub struct MediaSensor;

impl Sensor for MediaSensor {
    fn name(&self) -> &'static str {
        "media"
    }

    fn start(&self, _tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        tracing::debug!(sensor = "media", "stub");
        Ok(())
    }
}
