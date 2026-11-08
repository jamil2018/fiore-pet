# Fiore website

Purpose: maintain the static GitHub Pages landing page and direct release downloads.
last-verified: 2026-11-08

The public site is https://jamil2018.github.io/fiore-pet/. The [Pages workflow](../../.github/workflows/pages.yml) tests platform detection and publishes only the public HTML, CSS, JavaScript and artwork on changes to this folder on `main`. Enable GitHub Pages with GitHub Actions as the build source.

Preview with `npx vite docs/site --host 127.0.0.1`; run detection cases with `node --test docs/site/platform.test.mjs`. No build dependencies or third-party requests are needed by the page. The preview atlas is copied from `public/sprites/preview.png`; refresh it when pet artwork changes.

Downloads intentionally target the tested v0.3.0 release. When shipping a new version, update the visible version, platform requirements and exact asset URLs in `index.html` and the button hints in `app.js`, then check the release assets before publishing. Unknown/mobile browsers get a chooser; all visitors retain manual links. OS detection does not determine CPU architecture; the Windows build is explicitly labeled x64 and Mac is universal.

The [README installation notes](../../README.md#installation) own detailed security and troubleshooting guidance. The site summarizes first-run steps and links there for complete instructions.
