# Next.js PR Code Review

> Replace every placeholder. Remove this instruction before saving the final report.

## Executive Summary

- **PR / change:** `<number, URL, branch, or commit range>`
- **Purpose:** `<one or two sentences>`
- **Verdict:** `<Block | Needs changes | Approve with follow-ups | Approve>`
- **Risk level:** `<Critical | High | Medium | Low | None identified>`
- **Findings:** `<critical count> Critical · <high count> High · <medium count> Medium · <low count> Low`

`<Concise explanation of the most important result and what must happen before merge.>`

## Review Scope

- **Repository:** `<name/path>`
- **Base:** `<base ref and SHA when available>`
- **Head:** `<head ref and SHA when available>`
- **Framework:** `<Next.js version, React version, App/Pages Router>`
- **Package manager:** `<npm/pnpm/yarn/bun and version when available>`
- **Changed files reviewed:** `<count and important areas>`
- **Excluded/generated files:** `<items or None>`
- **Review limitations:** `<missing runtime, unavailable PR metadata, tests not runnable, etc.>`

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
- **Affected path:** `<request/action/component/data flow>`
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
- **Affected path:** `<route/render/data path>`
- **Evidence:** `<specific code behavior, build output, or measurement>`
- **Why it matters:** `<likely user/server impact; label unmeasured impact>`
- **Recommendation:** `<specific, proportionate fix>`
- **Verification:** `<measurement, test, build, or trace>`
- **Reference:** `<official Next.js/React/Web Vitals documentation>`

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

## Merge Recommendation

**`<Block | Needs changes | Approve with follow-ups | Approve>`**

`<Explain the decision and list the finding IDs that must be resolved before merge.>`

## References

- `<Reference title — URL or bibliographic citation>`
