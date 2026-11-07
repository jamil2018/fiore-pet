use std::sync::mpsc::Sender;

use crate::events::FioreEvent;
use crate::sensors::{Sensor, SensorError};

pub struct AudioPeakSensor;

impl Sensor for AudioPeakSensor {
    fn name(&self) -> &'static str {
        "audio_peak"
    }

    fn start(&self, _tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        tracing::debug!(sensor = "audio_peak", "stub");
        Ok(())
    }
}
