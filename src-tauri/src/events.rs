use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Coding,
    Writing,
    Browsing,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mood {
    Energetic,
    Content,
    Calm,
    Sleepy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Season {
    Winter,
    Spring,
    Summer,
    Autumn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StrokeDirection {
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicState {
    pub playing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_app: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub activity: Category,
    pub mood: Mood,
    pub season: Season,
    pub fullscreen: bool,
    pub music: MusicState,
}

/// Catalog events. Wire shape is `{"type","payload"}` with camelCase fields.
/// Variant renames are the only dotted strings in this enum; docs-check reads them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all_fields = "camelCase")]
pub enum FioreEvent {
    #[serde(rename = "state.snapshot")]
    StateSnapshot(Snapshot),
    #[serde(rename = "fullscreen.entered")]
    FullscreenEntered {},
    #[serde(rename = "fullscreen.exited")]
    FullscreenExited {},
    #[serde(rename = "pet.drag_start")]
    PetDragStart {},
    #[serde(rename = "pet.drag_end")]
    PetDragEnd {},
    #[serde(rename = "pet.hover_start")]
    PetHoverStart {},
    #[serde(rename = "pet.stroke")]
    PetStroke { direction: StrokeDirection },
    #[serde(rename = "pet.petted")]
    PetPetted {},
    #[serde(rename = "pet.hover_end")]
    PetHoverEnd { was_petted: bool },
    #[serde(rename = "app.category_changed")]
    AppCategoryChanged {
        category: Category,
        process: String,
        title: String,
    },
    #[serde(rename = "music.started")]
    MusicStarted {
        title: String,
        artist: String,
        source_app: String,
    },
    #[serde(rename = "music.level")]
    MusicLevel { peak: f64 },
    #[serde(rename = "music.track_changed")]
    MusicTrackChanged { title: String, artist: String },
    #[serde(rename = "music.stopped")]
    MusicStopped {},
    #[serde(rename = "time.mood_changed")]
    TimeMoodChanged { mood: Mood },
    #[serde(rename = "season.changed")]
    SeasonChanged { season: Season },
}

#[cfg(test)]
mod tests {
    // Fixture IO uses unwrap as the assertion; a bad fixture should fail the test.
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/behavior/golden/events")
    }

    #[test]
    fn fixtures_round_trip() {
        let dir = fixtures_dir();
        let mut files: Vec<_> = fs::read_dir(&dir)
            .unwrap_or_else(|err| panic!("read {}: {err}", dir.display()))
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"))
            .collect();
        files.sort();
        assert_eq!(files.len(), 16, "expected one fixture per catalog event");
        for path in files {
            let text = fs::read_to_string(&path).unwrap();
            let original: serde_json::Value = serde_json::from_str(&text).unwrap();
            let event: FioreEvent = serde_json::from_value(original.clone())
                .unwrap_or_else(|err| panic!("deserialize {}: {err}", path.display()));
            let back = serde_json::to_value(&event).unwrap();
            assert_eq!(original, back, "{}", path.display());
        }
    }
}
