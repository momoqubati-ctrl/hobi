# Pre-Push Local Review

> Replace every placeholder. Remove this instruction before saving the final report.

## Executive Summary

- **Diff scope:** `<uncommitted (working tree + staged) | staged | unpushed | all-local>`
- **Purpose:** `<one or two sentences on what these local changes do>`
- **Push recommendation:** `<Do not push | Fix before push | Push with follow-ups | Ready to push>`
- **Risk level:** `<Critical | High | Medium | Low | None identified>`
- **Findings:** `<critical count> Critical · <high count> High · <medium count> Medium · <low count> Low`

`<Concise explanation of the most important result and what must happen before pushing.>`

## Scorecard

| Category | Level | Findings (C/H/M/L) |
|---|---|---|
| Security | `<PASS | WARN | FAIL>` | `<0 / 0 / 0 / 0>` |
| Performance | `<PASS | WARN | FAIL>` | `<0 / 0 / 0 / 0>` |
| Clean Code | `<PASS | WARN | FAIL>` | `<0 / 0 / 0 / 0>` |
| **Overall** | **`<PASS | WARN | FAIL>` -> `<push recommendation>`** | `<0 / 0 / 0 / 0>` |

Levels follow `references/SCORING.md`: FAIL = any Critical/High; WARN = a Medium or 3+ Low; PASS = clean or ≤2 Low.

## Review Scope

- **Repository:** `<name/path>`
- **Branch:** `<branch and head SHA when available>`
- **Diff scope:** `<what was compared, e.g. working tree + staged vs HEAD>`
- **Stack:** `<languages/frameworks detected, with versions when available>`
- **Changed files reviewed:** `<count and important areas>`
- **Excluded/generated files:** `<items or None>`
- **Review limitations:** `<tests not runnable, missing runtime, partial diff, etc.>`

## Findings Overview

| ID | Category | Severity | Confidence | Location | Title |
|---|---|---:|---:|---|---|
| `<SEC-001>` | Security | `<High>` | `<High>` | `<path:line>` | `<title>` |

Use “No findings” when the table would otherwise be empty.

## Security

### `<SEC-001 — Concise title>`

- **Severity:** `<Critical | High | Medium | Low>`
- **Confidence:** `<High | Medium>`
- **Location:** `<path:line-range>`
- **Affected path:** `<entry point / data flow / trust boundary>`
- **Evidence:** `<specific code behavior or command result>`
- **Why it matters:** `<attack/failure scenario and application impact>`
- **Recommendation:** `<specific, proportionate fix>`
- **Verification:** `<test or check proving the fix>`
- **Reference:** `<official documentation, OWASP/CWE, or project rule>`

Repeat for each security finding. When empty, write: **No substantiated findings in the reviewed scope.**

## Performance

### `<PERF-001 — Concise title>`

- **Severity:** `<High | Medium | Low>`
- **Confidence:** `<High | Medium>`
- **Location:** `<path:line-range>`
- **Affected path:** `<request / query / render / data path>`
- **Evidence:** `<specific code behavior, query, build output, or measurement>`
- **Why it matters:** `<likely user/server impact; label unmeasured impact>`
- **Recommendation:** `<specific, proportionate fix>`
- **Verification:** `<measurement, test, build, or trace>`
- **Reference:** `<official documentation or measurement method>`

Repeat for each performance finding. When empty, write: **No substantiated findings in the reviewed scope.**

## Clean Code

### `<CLEAN-001 — Concise title>`

- **Severity:** `<Medium | Low>`
- **Confidence:** `<High | Medium>`
- **Location:** `<path:line-range>`
- **Evidence:** `<specific design, type, error-handling, or test issue>`
- **Why it matters:** `<correctness, maintenance, testing, or change-cost impact>`
- **Recommendation:** `<focused refactor or test>`
- **Verification:** `<expected behavior or test>`
- **Reference:** `<repository convention, official docs, or book principle>`

Repeat for each clean-code finding. When empty, write: **No substantiated findings in the reviewed scope.**

## Positive Observations

- `<Good security, performance, testing, or design decisions worth preserving.>`

Do not add praise that was not actually observed.

## Open Questions

- `<Question or low-confidence concern that needs product/runtime context.>`

Write “None.” when no questions remain. Do not promote unresolved speculation into a blocking finding.

## Validation Performed

| Command / check | Result | Notes |
|---|---|---|
| `<command>` | `<Passed | Failed | Skipped>` | `<details>` |

## Push Recommendation

**`<Do not push | Fix before push | Push with follow-ups | Ready to push>`**

`<Explain the decision and list the finding IDs that must be resolved before pushing.>`

## References

- `<Reference title — URL or bibliographic citation>`
