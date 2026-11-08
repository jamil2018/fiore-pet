use std::path::Path;
use std::sync::mpsc::Sender;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::events::{Category, FioreEvent};
use crate::sensors::{Sensor, SensorError};

const POLL: Duration = Duration::from_millis(500);
const HOLD_MS: u64 = 1_500;

#[derive(Debug, Deserialize)]
struct RulesFile {
    coding: Vec<String>,
    writing: Vec<String>,
    browsing: Vec<String>,
    #[serde(rename = "writingTitleKeywords")]
    writing_title_keywords: Vec<String>,
}

#[derive(Debug)]
struct Rules {
    coding: Vec<String>,
    writing: Vec<String>,
    browsing: Vec<String>,
    writing_title_keywords: Vec<String>,
}

fn parse_rules(text: &str) -> Result<Rules, SensorError> {
    let file: RulesFile = serde_json::from_str(text)
        .map_err(|err| SensorError::Failed(format!("app-categories.json: {err}")))?;
    Ok(Rules {
        coding: file.coding,
        writing: file.writing,
        browsing: file.browsing,
        writing_title_keywords: file
            .writing_title_keywords
            .into_iter()
            .filter(|keyword| !keyword.is_empty())
            .collect(),
    })
}

fn embedded_rules() -> Result<Rules, SensorError> {
    parse_rules(include_str!("../../resources/app-categories.json"))
}

fn file_name(exe: &str) -> &str {
    Path::new(exe)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(exe)
}

fn listed(names: &[String], exe: &str) -> bool {
    names.iter().any(|name| name.eq_ignore_ascii_case(exe))
}

fn contains_ignore_ascii_case(haystack: &str, needle: &str) -> bool {
    let needle_bytes = needle.as_bytes();
    if needle_bytes.is_empty() || needle_bytes.len() > haystack.len() {
        return false;
    }
    haystack
        .as_bytes()
        .windows(needle_bytes.len())
        .any(|window| window.eq_ignore_ascii_case(needle_bytes))
}

/// Case-insensitive file-name match. Browser titles can switch the result to writing.
/// A missing or unknown process is `other`.
fn classify(exe_name: Option<&str>, title: &str, rules: &Rules) -> Category {
    let Some(exe) = exe_name.map(file_name).filter(|name| !name.is_empty()) else {
        return Category::Other;
    };
    if listed(&rules.coding, exe) {
        return Category::Coding;
    }
    if listed(&rules.writing, exe) {
        return Category::Writing;
    }
    if listed(&rules.browsing, exe) {
        if rules
            .writing_title_keywords
            .iter()
            .any(|keyword| contains_ignore_ascii_case(title, keyword))
        {
            return Category::Writing;
        }
        return Category::Browsing;
    }
    Category::Other
}

#[derive(Debug, Default)]
struct HoldDebounce {
    committed: Option<Category>,
    pending: Option<Category>,
    pending_since_ms: u64,
}

impl HoldDebounce {
    /// The first sample is the baseline. Later categories emit after `HOLD_MS`.
    fn observe(&mut self, category: Category, now_ms: u64) -> bool {
        if self.committed.is_none() {
            self.committed = Some(category);
            self.pending = None;
            return true;
        }
        if self.committed == Some(category) {
            self.pending = None;
            return false;
        }
        if self.pending == Some(category) {
            if now_ms.saturating_sub(self.pending_since_ms) >= HOLD_MS {
                self.committed = Some(category);
                self.pending = None;
                return true;
            }
            return false;
        }
        self.pending = Some(category);
        self.pending_since_ms = now_ms;
        false
    }
}

#[derive(Clone)]
struct Reading {
    exe_name: Option<String>,
    title: String,
    own_process: bool,
}

trait ForegroundSource {
    fn poll(&self) -> Result<Option<Reading>, SensorError>;
}

/// A null window or our own process is not a sample, so the pending category stays.
fn on_reading(
    reading: Option<&Reading>,
    rules: &Rules,
    hold: &mut HoldDebounce,
    now_ms: u64,
) -> Option<FioreEvent> {
    let reading = reading?;
    if reading.own_process {
        return None;
    }
    let category = classify(reading.exe_name.as_deref(), &reading.title, rules);
    if !hold.observe(category, now_ms) {
        return None;
    }
    Some(FioreEvent::AppCategoryChanged {
        category,
        process: reading.exe_name.clone().unwrap_or_default(),
        title: reading.title.clone(),
    })
}

fn step(
    source: &impl ForegroundSource,
    rules: &Rules,
    hold: &mut HoldDebounce,
    now_ms: u64,
) -> Result<Option<FioreEvent>, SensorError> {
    Ok(on_reading(source.poll()?.as_ref(), rules, hold, now_ms))
}

fn monotonic_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn log_category(event: &FioreEvent) {
    if let FioreEvent::AppCategoryChanged {
        category,
        process,
        title,
    } = event
    {
        tracing::info!(
            sensor = "foreground",
            category = ?category,
            process = %process,
            "category changed"
        );
        tracing::debug!(sensor = "foreground", title = %title, "foreground title");
    }
}

fn poll_forever(
    source: &impl ForegroundSource,
    rules: &Rules,
    tx: &Sender<FioreEvent>,
) -> Result<(), SensorError> {
    let started = Instant::now();
    let mut hold = HoldDebounce::default();
    loop {
        let now_ms = monotonic_ms(started);
        if let Some(event) = step(source, rules, &mut hold, now_ms)? {
            log_category(&event);
            if tx.send(event).is_err() {
                return Ok(());
            }
        }
        thread::park_timeout(POLL);
    }
}

#[cfg(windows)]
struct WinForeground;

#[cfg(windows)]
impl ForegroundSource for WinForeground {
    fn poll(&self) -> Result<Option<Reading>, SensorError> {
        let Some(window) = crate::sensors::win::foreground() else {
            return Ok(None);
        };
        Ok(Some(Reading {
            own_process: crate::sensors::win::is_own_pid(window.pid),
            exe_name: window.exe_name,
            title: window.title,
        }))
    }
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Deserialize)]
pub(super) struct MacDesktop {
    pub status: String,
    pub pid: Option<u32>,
    pub bundle_id: Option<String>,
    pub title: Option<String>,
    #[serde(default)]
    pub is_self: bool,
    pub fullscreen: Option<bool>,
    pub window: Option<super::fullscreen::MacRect>,
    pub display: Option<super::fullscreen::MacRect>,
}

#[cfg(any(target_os = "macos", test))]
impl MacDesktop {
    fn reading(self) -> Result<Option<Reading>, SensorError> {
        match self.status.as_str() {
            "unavailable" | "denied" => Ok(None),
            "ok" if self.pid.is_none() => Ok(None),
            "ok" => Ok(Some(Reading {
                exe_name: self.bundle_id,
                title: self.title.unwrap_or_default(),
                own_process: self.is_self,
            })),
            _ => Err(SensorError::Failed("macOS desktop bridge failed".into())),
        }
    }
}

#[cfg(target_os = "macos")]
pub(super) fn mac_snapshot() -> Result<MacDesktop, SensorError> {
    unsafe extern "C" {
        fn fiore_macos_desktop_snapshot() -> *mut std::ffi::c_char;
    }
    // SAFETY: native bridge returns NULL or a malloc-owned NUL-terminated UTF-8 string.
    super::macos::snapshot(unsafe { fiore_macos_desktop_snapshot() })
}

#[cfg(target_os = "macos")]
struct MacForeground;

#[cfg(target_os = "macos")]
impl ForegroundSource for MacForeground {
    fn poll(&self) -> Result<Option<Reading>, SensorError> {
        mac_snapshot()?.reading()
    }
}

#[cfg(target_os = "macos")]
fn platform_start(rules: &Rules, tx: Sender<FioreEvent>) -> Result<(), SensorError> {
    poll_forever(&MacForeground, rules, &tx)
}

pub struct ForegroundSensor;

impl Sensor for ForegroundSensor {
    fn name(&self) -> &'static str {
        "foreground"
    }

    fn start(&self, tx: Sender<FioreEvent>) -> Result<(), SensorError> {
        let rules = embedded_rules()?;
        platform_start(&rules, tx)
    }
}

#[cfg(windows)]
fn platform_start(rules: &Rules, tx: Sender<FioreEvent>) -> Result<(), SensorError> {
    poll_forever(&WinForeground, rules, &tx)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn platform_start(rules: &Rules, tx: Sender<FioreEvent>) -> Result<(), SensorError> {
    let _ = (rules, tx);
    Ok(())
}

#[cfg(test)]
mod tests {
    // Assertions use unwrap and panic; production code does not.
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;

    struct FakeSource {
        reading: RefCell<Option<Reading>>,
    }

    impl ForegroundSource for FakeSource {
        fn poll(&self) -> Result<Option<Reading>, SensorError> {
            Ok(self.reading.borrow().clone())
        }
    }

    fn rules() -> Rules {
        embedded_rules().unwrap()
    }

    fn sample(exe: Option<&str>, title: &str, own: bool) -> Reading {
        Reading {
            exe_name: exe.map(str::to_string),
            title: title.to_string(),
            own_process: own,
        }
    }

    fn changed(event: &FioreEvent) -> (Category, &str, &str) {
        match event {
            FioreEvent::AppCategoryChanged {
                category,
                process,
                title,
            } => (*category, process, title),
            other => panic!("expected app.category_changed, got {other:?}"),
        }
    }

    #[test]
    fn embedded_app_categories_parse() {
        let parsed = rules();
        for name in [
            "Code.exe",
            "Cursor.exe",
            "devenv.exe",
            "idea64.exe",
            "pycharm64.exe",
            "sublime_text.exe",
            "WindowsTerminal.exe",
        ] {
            assert_eq!(
                classify(Some(name), "x", &parsed),
                Category::Coding,
                "{name}"
            );
        }
        for name in [
            "notepad.exe",
            "notepad++.exe",
            "WINWORD.EXE",
            "Obsidian.exe",
            "Notion.exe",
        ] {
            assert_eq!(
                classify(Some(name), "News", &parsed),
                Category::Writing,
                "{name}"
            );
        }
        for name in [
            "chrome.exe",
            "msedge.exe",
            "firefox.exe",
            "brave.exe",
            "opera.exe",
        ] {
            assert_eq!(
                classify(Some(name), "News", &parsed),
                Category::Browsing,
                "{name}"
            );
        }
    }

    #[test]
    fn bad_json_is_a_sensor_error() {
        let err = parse_rules("{").unwrap_err();
        assert!(matches!(err, SensorError::Failed(_)));
    }

    #[test]
    fn ac_ac_1_browser_title_keywords() {
        let parsed = rules();
        assert_eq!(
            classify(Some("chrome.exe"), "Doc - Google Docs", &parsed),
            Category::Writing
        );
        assert_eq!(
            classify(Some("CHROME.EXE"), "News", &parsed),
            Category::Browsing
        );
        assert_eq!(
            classify(Some("chrome.exe"), "Team Notion", &parsed),
            Category::Writing
        );
        assert_eq!(
            classify(Some("chrome.exe"), "Essay - Word", &parsed),
            Category::Writing
        );
        assert_eq!(
            classify(Some("notepad.exe"), "News", &parsed),
            Category::Writing
        );
        assert_eq!(
            classify(Some("Code.exe"), "Doc - Google Docs", &parsed),
            Category::Coding
        );
        let path = PathBuf::from("Program Files").join("chrome.exe");
        assert_eq!(
            classify(Some(path.to_str().unwrap()), "News", &parsed),
            Category::Browsing
        );
    }

    #[test]
    fn ac_ac_2_revert_within_hold_emits_nothing() {
        let parsed = rules();
        let mut hold = HoldDebounce::default();
        let baseline = on_reading(
            Some(&sample(Some("chrome.exe"), "News", false)),
            &parsed,
            &mut hold,
            0,
        )
        .unwrap();
        assert_eq!(changed(&baseline).0, Category::Browsing);

        assert!(on_reading(
            Some(&sample(Some("Code.exe"), "main", false)),
            &parsed,
            &mut hold,
            100,
        )
        .is_none());
        assert!(on_reading(
            Some(&sample(Some("chrome.exe"), "News", false)),
            &parsed,
            &mut hold,
            1_000,
        )
        .is_none());
        assert!(on_reading(
            Some(&sample(Some("chrome.exe"), "News", false)),
            &parsed,
            &mut hold,
            2_000,
        )
        .is_none());
    }

    #[test]
    fn category_emits_after_it_holds_for_1500_ms() {
        let parsed = rules();
        let mut hold = HoldDebounce::default();
        on_reading(
            Some(&sample(Some("chrome.exe"), "News", false)),
            &parsed,
            &mut hold,
            0,
        )
        .unwrap();
        assert!(on_reading(
            Some(&sample(Some("Code.exe"), "main", false)),
            &parsed,
            &mut hold,
            100,
        )
        .is_none());
        assert!(on_reading(
            Some(&sample(Some("Code.exe"), "main", false)),
            &parsed,
            &mut hold,
            1_599,
        )
        .is_none());
        let event = on_reading(
            Some(&sample(Some("Code.exe"), "main.rs", false)),
            &parsed,
            &mut hold,
            1_600,
        )
        .unwrap();
        assert_eq!(changed(&event), (Category::Coding, "Code.exe", "main.rs"));
    }

    #[test]
    fn null_window_keeps_the_pending_candidate() {
        let parsed = rules();
        let mut hold = HoldDebounce::default();
        on_reading(
            Some(&sample(Some("chrome.exe"), "News", false)),
            &parsed,
            &mut hold,
            0,
        )
        .unwrap();
        assert!(on_reading(
            Some(&sample(Some("Code.exe"), "main", false)),
            &parsed,
            &mut hold,
            200,
        )
        .is_none());
        assert!(on_reading(None, &parsed, &mut hold, 1_000).is_none());
        let event = on_reading(
            Some(&sample(Some("Code.exe"), "main", false)),
            &parsed,
            &mut hold,
            1_700,
        )
        .unwrap();
        assert_eq!(changed(&event).0, Category::Coding);
    }

    #[test]
    fn ac_ac_3_own_process_never_changes_category() {
        let parsed = rules();
        let source = FakeSource {
            reading: RefCell::new(Some(sample(Some("chrome.exe"), "News", true))),
        };
        let mut hold = HoldDebounce::default();
        assert!(step(&source, &parsed, &mut hold, 0).unwrap().is_none());
        source
            .reading
            .replace(Some(sample(Some("fiore.exe"), "Fiore", true)));
        assert!(step(&source, &parsed, &mut hold, 5_000).unwrap().is_none());

        source
            .reading
            .replace(Some(sample(Some("chrome.exe"), "News", false)));
        let baseline = step(&source, &parsed, &mut hold, 5_500).unwrap().unwrap();
        assert_eq!(changed(&baseline).0, Category::Browsing);

        source
            .reading
            .replace(Some(sample(Some("Code.exe"), "main", true)));
        assert!(step(&source, &parsed, &mut hold, 6_000).unwrap().is_none());
        assert!(step(&source, &parsed, &mut hold, 9_000).unwrap().is_none());
        source
            .reading
            .replace(Some(sample(Some("chrome.exe"), "News", false)));
        assert!(step(&source, &parsed, &mut hold, 9_000).unwrap().is_none());
    }

    #[test]
    fn ac_ac_4_unknown_process_is_other() {
        let parsed = rules();
        assert_eq!(
            classify(Some("explorer.exe"), "Desktop", &parsed),
            Category::Other
        );
        assert_eq!(
            classify(None, "Doc - Google Docs", &parsed),
            Category::Other
        );
        assert_eq!(classify(Some(""), "News", &parsed), Category::Other);
        let mut hold = HoldDebounce::default();
        let event =
            on_reading(Some(&sample(None, "Desktop", false)), &parsed, &mut hold, 0).unwrap();
        assert_eq!(changed(&event), (Category::Other, "", "Desktop"));
    }

    #[test]
    fn foreground_poll_is_500_ms() {
        assert_eq!(POLL, Duration::from_millis(500));
        assert_eq!(HOLD_MS, 1_500);
    }

    #[test]
    fn mac_bundle_rules_and_permission_limited_titles() {
        let rules = rules();
        for (bundle, expected) in [
            ("com.microsoft.VSCode", Category::Coding),
            ("com.apple.dt.Xcode", Category::Coding),
            ("com.apple.TextEdit", Category::Writing),
            ("com.apple.Safari", Category::Browsing),
            ("com.google.Chrome", Category::Browsing),
            ("unknown.app", Category::Other),
        ] {
            assert_eq!(classify(Some(bundle), "", &rules), expected);
        }
        assert_eq!(
            classify(Some("com.apple.Safari"), "Report - Google Docs", &rules),
            Category::Writing
        );
        let snapshot: MacDesktop = serde_json::from_str(r#"{"status":"ok","pid":42,"bundle_id":"com.apple.Safari","title":null,"is_self":false}"#).unwrap();
        let reading = snapshot.reading().unwrap().unwrap();
        assert_eq!(reading.title, "");
        assert_eq!(
            classify(reading.exe_name.as_deref(), &reading.title, &rules),
            Category::Browsing
        );
    }

    #[test]
    fn mac_unknown_and_errors_do_not_become_activity() {
        for json in [
            r#"{"status":"unavailable"}"#,
            r#"{"status":"denied"}"#,
            r#"{"status":"ok","pid":null}"#,
        ] {
            let snapshot: MacDesktop = serde_json::from_str(json).unwrap();
            assert!(snapshot.reading().unwrap().is_none());
        }
        let failure: MacDesktop = serde_json::from_str(r#"{"status":"error"}"#).unwrap();
        assert!(failure.reading().is_err());
        assert!(serde_json::from_str::<MacDesktop>(r#"{"status":"ok","pid":"bad"}"#).is_err());
        let own: MacDesktop = serde_json::from_str(
            r#"{"status":"ok","pid":42,"bundle_id":"com.apple.Safari","is_self":true}"#,
        )
        .unwrap();
        assert!(on_reading(
            own.reading().unwrap().as_ref(),
            &rules(),
            &mut HoldDebounce::default(),
            0
        )
        .is_none());
    }
}
