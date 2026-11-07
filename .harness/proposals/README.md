# Proposals

Purpose: user-approved changes to harness prompts, rules, skills, hooks or scripts, written by `/retro`.
last-verified: 2026-11-07

- **Name:** `NNN-<slug>.md` (zero-padded sequence, kebab slug). Shape: `docs/harness/templates/proposal.md`.
- **Status:** `proposed`, `approved`, `applied`, `rejected`. Only the user moves a proposal to `approved`.
- **Flow:** `/retro` writes a proposal with evidence and an exact diff. The user approves. `/approve-proposal NNN` applies the diff, then runs `/eval`. No regression against `evals/baseline.json`: keep it, mark `applied`. Regression: revert and mark `rejected` with the failing metric.
- **Never:** edit harness files (`.cursor/agents|rules|skills|hooks`, `docs/harness/*` except `lessons.md`) without an approved proposal id.
- **Tracked:** proposals stay in git as the audit trail of how the harness evolved.
