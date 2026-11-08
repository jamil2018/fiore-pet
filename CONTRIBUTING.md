# Contributing to Fiore

Purpose: help contributors report issues, develop changes and submit pull requests.
last-verified: 2026-11-09

Bug reports, documentation, accessibility improvements, artwork and code contributions are welcome. Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Start with an issue

Search [existing issues](https://github.com/jamil2018/fiore-pet/issues) before opening a report. Include the Fiore version, OS version, steps to reproduce, expected behavior and what happened. For animation bugs, describe simultaneous activities (for example, coding with music while sleepy) and include a screenshot or short recording when useful.

Remove private window titles, track names, usernames and credentials from logs or screenshots. Report vulnerabilities through the [security policy](SECURITY.md), not a public issue.

For substantial features or architecture changes, open a feature request first so we can agree on scope before you spend time implementing it. Small fixes and documentation edits can go straight to a pull request. The [backlog](docs/backlog.md) records deferred work; an entry is not a promise of acceptance.

## Develop locally

1. Fork the repository and clone your fork.
2. Follow the [local build prerequisites](docs/releasing.md#local-builds), then run `npm ci` in the repository root.
3. Create a branch for one focused change.
4. Use `npm run dev:mock` for the browser preview or `npm run tauri dev` for the desktop app. The desktop command starts a real pet and native sensors on your machine.

The browser preview does not exercise OS sensors or installer behavior. See [Mac sensor setup](docs/reference/macos-sensors.md) for platform permissions and known limitations. You do not need signing credentials or an API key to contribute.

## Make a focused change

- Read the [code map](docs/codemap.md) to find the relevant module and follow the [conventions](docs/conventions.md).
- The [MVP spec](docs/fiore-mvp-spec.md) owns supported events and behavior. Propose spec changes alongside changes to behavior; do not silently introduce new triggers.
- Preserve privacy: never read keystroke content, and do not add sensitive logging or telemetry.
- Bug fixes should include a focused regression test. Explain checks that require real hardware or an interactive desktop.
- For sprite work, edit `scripts/dev/generate-sprites.mjs` and regenerate with `node scripts/dev/generate-sprites.mjs`. Inspect actual layered frames, including moods, outfits and concurrent activities. See the [atlas reference](docs/reference/sprite-atlas.md).
- Keep generated changes reproducible. Do not commit credentials, local logs, build output or unrelated formatting changes.

## Check your work

Run the relevant gate from the repository root:

```powershell
pwsh scripts/check.ps1 -Tier fast -Scope src/behavior,src/render
```

Replace the scope with your changed paths, or omit `-Scope` for the complete fast gate. Run `pwsh scripts/check.ps1 -Tier full` for app-wide or packaging changes when your environment supports it. The [testing guide](docs/testing.md) owns test coverage and manual checks.

For website changes, also run `node --test docs/site/*.test.mjs` and follow the [site guide](docs/site/README.md). Do not skip failing tests or suppress lints to get a passing result. State any check you could not run and why.

## Open a pull request

Target `main`. Describe the problem, the resulting behavior and how you tested it. Include before/after images for visual changes and name the platforms you actually tested. Link the related issue when there is one. Use a concise [conventional commit](docs/conventions.md#commits) title.

Pull requests run Windows checks, Mac checks and a secret scan. Maintainers review scope, correctness, privacy and platform impact before merging. Releases and signing are maintainer responsibilities; do not bump the version unless agreed as part of the change.

The [agent guide](AGENTS.md) and [harness](docs/harness/README.md) cover AI-assisted repository workflows. Human contributors do not need to run agent planning or judging commands.

## Licensing contributions

Submit only work you have the right to contribute. Unless explicitly agreed otherwise, contributions to Fiore are provided under the repository's [MIT license](LICENSE). Keep any required third-party notices and identify third-party code or assets in your pull request. No copyright assignment is requested.
