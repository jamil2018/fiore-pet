# Fiore website

Purpose: maintain the static GitHub Pages landing page and direct release downloads.
last-verified: 2026-11-08

The public site is https://jamil2018.github.io/fiore-pet/. The [Pages workflow](../../.github/workflows/pages.yml) tests and builds the public HTML, CSS, JavaScript and artwork on changes to this folder on `main`. Enable GitHub Pages with GitHub Actions as the build source. `node docs/site/build.mjs <output-directory>` fingerprints asset filenames and rewrites HTML, CSS image references and JavaScript imports so new pages cannot reuse stale styles from a previous deployment. The SVG cat icon is shared by the header and favicon.

Preview with `npx vite docs/site --host 127.0.0.1`; run site checks with `node --test docs/site/*.test.mjs`. To inspect production asset references, serve the build output directory instead. No build dependencies or third-party requests are needed by the page. The preview atlas is copied from `public/sprites/preview.png`; refresh it when pet artwork changes.

Downloads intentionally target the tested v0.3.0 release. When shipping a new version, update the visible version, platform requirements and exact asset URLs in `index.html` and the button hints in `app.js`, then check the release assets before publishing. Unknown/mobile browsers get a chooser; all visitors retain manual links. OS detection does not determine CPU architecture; the Windows build is explicitly labeled x64 and Mac is universal.

The [README installation notes](../../README.md#installation) own detailed security and troubleshooting guidance. The site links there instead of repeating installation steps.

The bento grid automatically previews the actual atlas rows for coding, writing, browsing, music, petting and fullscreen hide/return. The last sequence is a demonstration, not browser fullscreen detection. Feature cards below the grid cover placement, privacy, tray controls and seasonal/time reactions. Website-only greeting and pointing poses use short paws matching the body proportions; reproduce them with `node docs/site/generate-gestures.mjs`. They do not add desktop events or change app sprites. Hover or keyboard focus makes the hero happy; leaving restores the wave. Touch taps toggle the greeting.

The theme follows the system until the visitor chooses a mode, then stores that preference locally. Storage failures leave controls usable. The global animation control pauses all sprites; reduced-motion preferences show static poses with every event description still visible.
