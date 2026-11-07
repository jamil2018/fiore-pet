mod audio_peak;
mod clock;
mod foreground;
mod fullscreen;
mod media;

use std::sync::mpsc::Sender;

use crate::events::FioreEvent;

#[derive(Debug, thiserror::Error)]
pub enum SensorError {
    // Returned when a sensor's start fails. W1.0 stubs succeed; hub tests construct it.
    #[allow(dead_code)]
    #[error("{0}")]
    Failed(String),
}

pub trait Sensor: Send + Sync + 'static {
    fn name(&self) -> &'static str;
    fn start(&self, tx: Sender<FioreEvent>) -> Result<(), SensorError>;
}

pub fn all() -> Vec<Box<dyn Sensor>> {
    vec![
        Box::new(media::MediaSensor),
        Box::new(audio_peak::AudioPeakSensor),
        Box::new(foreground::ForegroundSensor),
        Box::new(fullscreen::FullscreenSensor),
        Box::new(clock::ClockSensor),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_registers_five_unique_sensors() {
        let sensors = all();
        assert_eq!(sensors.len(), 5);
        let mut names: Vec<_> = sensors.iter().map(|sensor| sensor.name()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), 5);
        assert_eq!(
            sensors
                .iter()
                .map(|sensor| sensor.name())
                .collect::<Vec<_>>(),
            vec!["media", "audio_peak", "foreground", "fullscreen", "clock"]
        );
    }
}
