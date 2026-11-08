import assert from "node:assert/strict";
import test from "node:test";
import { detectPlatform } from "./platform.mjs";

for (const [label, input, expected] of [
  ["Windows browser", { platform: "Win32" }, "windows"],
  [
    "Windows client hints",
    { userAgentData: { platform: "Windows", mobile: false } },
    "windows",
  ],
  [
    "Intel or Apple Silicon Mac",
    { platform: "MacIntel", maxTouchPoints: 0 },
    "mac",
  ],
  [
    "Safari UA fallback",
    { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    "mac",
  ],
  [
    "iPad desktop mode",
    { platform: "MacIntel", maxTouchPoints: 5 },
    "unsupported",
  ],
  [
    "iPhone",
    { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS like Mac OS X)" },
    "unsupported",
  ],
  [
    "Android",
    { platform: "Linux armv8l", userAgent: "Mozilla/5.0 Android" },
    "unsupported",
  ],
  ["Linux", { platform: "Linux x86_64" }, "unsupported"],
  [
    "mobile client hints",
    { userAgentData: { platform: "Windows", mobile: true } },
    "unsupported",
  ],
  ["unknown platform", {}, "unsupported"],
])
  test(label, () => assert.equal(detectPlatform(input), expected));
