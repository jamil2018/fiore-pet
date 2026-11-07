use std::sync::mpsc::Sender;

use crate::events::FioreEvent;
use crate::sensors::{Sensor, SensorError};

pub struct ClockSensor;

impl Sensor for ClockSensor {
    fn name(&self) -> &'static str {
        "clock"
    }

    fn start(&self, _tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        tracing::debug!(sensor = "clock", "stub");
        Ok(())
    }
}
