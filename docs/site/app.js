import { detectPlatform } from "./platform.mjs";

const platform = detectPlatform(navigator);
const download = document.querySelector("#download");
const hint = document.querySelector("#download-hint");
if (platform === "windows" || platform === "mac") {
  const target = document.querySelector(`#${platform}-download`);
  download.href = target.href;
  download.textContent = `${platform === "windows" ? "Download for Windows" : "Download for Mac"} ↓`;
  hint.textContent =
    platform === "windows"
      ? "v0.3.0 · Windows 10/11 x64 · Unsigned installer"
      : "v0.3.0 · Universal DMG · Experimental Mac preview";
} else {
  hint.textContent = "Fiore is a desktop app for Windows and macOS.";
}

const motion = document.querySelector("#motion");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
function syncMotion() {
  motion.disabled = reducedMotion.matches;
  motion.textContent = reducedMotion.matches
    ? "Reduced motion enabled"
    : document.body.classList.contains("paused")
      ? "Play animation"
      : "Pause animation";
  motion.setAttribute(
    "aria-pressed",
    String(reducedMotion.matches || document.body.classList.contains("paused")),
  );
}
motion.addEventListener("click", () => {
  document.body.classList.toggle("paused");
  syncMotion();
});
reducedMotion.addEventListener("change", syncMotion);
syncMotion();
