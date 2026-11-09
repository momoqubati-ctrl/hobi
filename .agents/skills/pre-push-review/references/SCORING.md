# Scoring reference — Pass / Warn / Fail per measurement

The pre-push review rates three measurements independently — **Security**, **Performance**, and **Clean Code** —
and then derives one overall **push recommendation**. Scores are mechanical: they follow the findings, not a gut
feeling. Classify every finding first (Phase 7), then apply the rules below. Two reviewers with the same findings
must reach the same scores.

## Inputs

Each finding already carries a **severity** (Critical / High / Medium / Low) and a **confidence**
(High / Medium / Low). For scoring:

- Count only findings whose confidence is **High or Medium**. Low-confidence concerns belong under
  **Open Questions** and must not move a score on their own.
- Count each root cause once, in its primary category (see Phase 7). Do not double-count the same issue across
  measurements.

## Per-measurement level

For each measurement, count its confirmed findings by severity, then apply the first matching row:

| Level | Rule for that measurement |
|---|---|
| **FAIL** | At least one **Critical**, or at least one **High** finding |
| **WARN** | No Critical/High, but at least one **Medium**, or **three or more Low** |
| **PASS** | No findings, or at most **two Low** findings |

Notes:

- Clean Code findings are usually Medium or Low, so Clean Code most often lands at PASS or WARN. Reserve High/Critical
  for clean-code issues that are really correctness or data-integrity bugs (in which case prefer the Security or the
  most-impacted category).
- A measurement with zero findings is **PASS**, never "N/A".

## Overall push recommendation

Take the worst measurement level and the severities behind it, then choose one recommendation:

| Recommendation | When |
|---|---|
| **Do not push** | Any measurement is **FAIL because of a Critical**, or a confirmed High security/correctness issue makes pushing unsafe |
| **Fix before push** | Any measurement is **FAIL** (High-driven), or two or more measurements are **WARN** with material Medium issues |
| **Push with follow-ups** | No FAIL; only WARN/PASS measurements with bounded Medium/Low improvements that can be tracked separately |
| **Ready to push** | All three measurements are **PASS** |

The recommendation must follow the evidence, not the number of comments. A single confirmed Critical outranks any
number of Low notes.

## Worked examples

- Security `0C/0H/0M/0L`, Performance `0C/0H/1M/0L`, Clean Code `0C/0H/0M/2L`
  → Security PASS, Performance WARN, Clean Code PASS → **Push with follow-ups**.
- Security `0C/1H/0M/0L` (e.g. missing authorization on a privileged action)
  → Security FAIL → **Fix before push** (or **Do not push** if it is directly exploitable).
- Security `1C/.../...` (e.g. a committed live secret, SQL injection)
  → Security FAIL (Critical) → **Do not push**.
- All measurements `0/0/0/0` → all PASS → **Ready to push**.

## Rendering the Scorecard

Render the result as the `## Scorecard` table in the report, including a per-category Findings count `(C/H/M/L)` and
an **Overall** row that states the level and the chosen recommendation, for example:

```
| Category    | Level | Findings (C/H/M/L) |
|-------------|-------|--------------------|
| Security    | WARN  | 0 / 0 / 1 / 2      |
| Performance | PASS  | 0 / 0 / 0 / 0      |
| Clean Code  | PASS  | 0 / 0 / 0 / 1      |
| **Overall** | **WARN -> Push with follow-ups** | 0 / 0 / 1 / 3 |
```
