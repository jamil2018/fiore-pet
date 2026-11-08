import { detectPlatform } from "./platform.mjs";

const platform = detectPlatform(navigator);
const hint = document.querySelector("#download-hint");
if (platform === "windows" || platform === "mac") {
  const target = document.querySelector(`#${platform}-download`);
  for (const link of document.querySelectorAll("#download, #download-bottom")) {
    link.href = target.href;
    link.textContent = `Download for ${platform === "windows" ? "Windows" : "Mac"} ↓`;
  }
  hint.textContent =
    platform === "windows"
      ? "v0.3.0 · Windows 10/11 x64"
      : "v0.3.0 · Mac universal preview";
} else {
  hint.textContent = "Available for Windows and macOS desktops.";
}

const theme = document.querySelector("#theme");
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
let manualTheme = false;
try {
  manualTheme = ["light", "dark"].includes(localStorage.getItem("fiore-theme"));
} catch {}
function syncTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  theme.setAttribute("aria-pressed", String(dark));
  theme.setAttribute("aria-label", dark ? "Use light mode" : "Use dark mode");
  document.querySelector('meta[name="theme-color"]').content = dark
    ? "#171e1b"
    : "#f7f4eb";
}
theme.addEventListener("click", () => {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  manualTheme = true;
  try {
    localStorage.setItem("fiore-theme", next);
  } catch {}
  syncTheme();
});
systemTheme.addEventListener("change", () => {
  if (!manualTheme)
    document.documentElement.dataset.theme = systemTheme.matches
      ? "dark"
      : "light";
  syncTheme();
});
syncTheme();

const motion = document.querySelector("#motion");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
function syncMotion() {
  motion.disabled = reducedMotion.matches;
  const paused = document.body.classList.contains("paused");
  motion.textContent = reducedMotion.matches
    ? "Reduced motion enabled"
    : paused
      ? "Play animations"
      : "Pause animations";
  motion.setAttribute("aria-pressed", String(reducedMotion.matches || paused));
}
motion.addEventListener("click", () => {
  document.body.classList.toggle("paused");
  syncMotion();
});
reducedMotion.addEventListener("change", syncMotion);
syncMotion();

const greet = document.querySelector("#greet");
const greetingSprite = greet.querySelector(".sprite");
let hovered = false;
let keyboardFocused = false;
let tapped = false;
function syncGreeting() {
  const active = hovered || keyboardFocused || tapped;
  greetingSprite.classList.toggle("gesture", !active);
  greetingSprite.style.setProperty("--row", active ? 12 : 0);
  document.querySelector("#greeting").textContent = active
    ? "Happy to see you."
    : "Hover or tap Fiore.";
}
greet.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "touch") return;
  hovered = true;
  syncGreeting();
});
greet.addEventListener("pointerleave", () => {
  hovered = false;
  syncGreeting();
});
greet.addEventListener("focus", () => {
  keyboardFocused = greet.matches(":focus-visible");
  syncGreeting();
});
greet.addEventListener("blur", () => {
  keyboardFocused = false;
  tapped = false;
  syncGreeting();
});
greet.addEventListener("click", (event) => {
  // Mouse hover is transient; taps keep the reaction visible until another tap.
  if (event.pointerType === "touch" || !hovered) tapped = !tapped;
  syncGreeting();
});
