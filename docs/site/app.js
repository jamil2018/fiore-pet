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

const reactions = {
  code: [
    5,
    1,
    "Editor open",
    "A coding buddy.",
    "Open your editor. Fiore gets to work too.",
    "Fiore typing on a laptop",
  ],
  write: [
    7,
    1,
    "Writing app open",
    "Taking notes.",
    "A little pen for your next big idea.",
    "Fiore writing in a notepad",
  ],
  browse: [
    8,
    1,
    "Browser open",
    "Something interesting?",
    "Fiore browses alongside you.",
    "Fiore looking at a tablet",
  ],
  music: [
    9,
    0.8,
    "Music playing",
    "Found the rhythm.",
    "Press play. Fiore joins in.",
    "Fiore dancing to music",
  ],
  pet: [
    12,
    1,
    "Pet hovered",
    "That’s the spot.",
    "Hover over Fiore for a happy reaction.",
    "Fiore smiling with hearts",
  ],
  fullscreen: [
    14,
    1,
    "Fullscreen entered / exited",
    "Out of the way.",
    "Fiore hides in fullscreen and returns when you leave.",
    "Fiore hiding and reappearing",
  ],
};
const pet = document.querySelector("#event-pet");
for (const button of document.querySelectorAll("[data-event]")) {
  button.addEventListener("click", () => {
    const name = button.dataset.event;
    const [row, speed, context, title, description, label] = reactions[name];
    for (const option of document.querySelectorAll("[data-event]"))
      option.setAttribute("aria-pressed", String(option === button));
    pet.style.setProperty("--row", row);
    pet.style.setProperty("--speed", `${speed}s`);
    pet.classList.toggle("fullscreen-hide", name === "fullscreen");
    pet.setAttribute("aria-label", label);
    document.querySelector("#event-context").textContent = context;
    document.querySelector("#event-title").textContent = title;
    document.querySelector("#event-description").textContent = description;
  });
}
document.querySelector("#greet").addEventListener("click", () => {
  const sprite = document.querySelector("#greet .sprite");
  const greeted = sprite.classList.toggle("greeted");
  sprite.classList.toggle("gesture", !greeted);
  sprite.style.setProperty("--row", greeted ? 12 : 0);
  document.querySelector("#greeting").textContent = greeted
    ? "Happy to see you."
    : "Wave back.";
});
