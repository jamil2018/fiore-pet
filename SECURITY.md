# Security policy

Purpose: explain supported versions and private vulnerability reporting.
last-verified: 2026-11-09

## Supported versions

Security fixes target the latest release and `main`. Older releases do not have a separate backport commitment. macOS remains an experimental preview; its known coverage and runtime limitations are documented in the [Mac sensor guide](docs/reference/macos-sensors.md).

## Report a vulnerability privately

Use [GitHub's private vulnerability reporting](https://github.com/jamil2018/fiore-pet/security/advisories/new). Do not put exploit details, credentials or private user data in public issues.

Include the affected version and platform, steps to reproduce, impact, and a minimal proof of concept when available. Use synthetic data and test only systems you own or have permission to assess. If the reporting link is unavailable, open a minimal issue requesting a private security contact, without disclosing the vulnerability itself.

Maintainers will investigate and coordinate a fix and disclosure with the reporter. This is a volunteer project; no response-time guarantee or paid bug bounty is offered. Please allow time to investigate before publishing details.

Ordinary bugs and feature requests belong in [GitHub issues](https://github.com/jamil2018/fiore-pet/issues). Expected unsigned-build installation prompts are documented in the [installation notes](README.md#installation).
