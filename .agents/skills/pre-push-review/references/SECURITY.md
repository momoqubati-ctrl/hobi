# Security reference (stack-agnostic)

Apply these checks to whatever language and framework the change touches. The goal is to find a reachable attack or
failure path introduced or worsened by the local change — a tainted source, an unsafe sink, or a missing control —
not to recite generic rules. Confirm the framework and version from the manifests before applying version-specific
advice.

## Trust boundaries and input

- Treat every externally influenced input as hostile: request bodies, query/path params, headers, cookies, uploaded
  files, webhook payloads, message-queue jobs, env-driven config, and third-party API responses.
- Validate on the server against an allowlist/schema; never rely on client-side validation or UI visibility for
  security. Canonicalize before checks (paths, URLs, encodings) to avoid bypasses.
- Confirm that hidden or "internal" endpoints (actions, RPC handlers, admin routes, cron/queue entry points) enforce
  the same authorization as the visible UI — they are directly callable.

## Authentication and authorization

- Every privileged operation must check **authentication** and **object/function-level authorization** at the point
  of action, close to the data — not only in middleware, a gateway, or the UI.
- Verify ownership/tenant scoping on every record access (guard against IDOR / broken object-level authorization).
- Check password hashing (strong, salted KDF), session lifecycle, token expiry/rotation, and that privilege checks
  are not skippable via alternate code paths.

## Injection and unsafe sinks

- SQL/NoSQL injection: require parameterized queries / bound parameters; flag string-built queries, raw fragments,
  and dynamic column/order/table names from user input.
- Command, template, header, log, and path-traversal injection; unsafe deserialization; dynamic evaluation
  (`eval`, `exec`, reflection on user input).
- Output encoding/escaping for the sink (HTML, attribute, URL, shell, SQL). Flag raw/unescaped rendering and
  unsanitized HTML.

## Web-surface risks

- XSS (stored/reflected/DOM), CSRF on state-changing requests, CORS misconfiguration, open redirects, SSRF via
  user-controlled URLs, clickjacking / missing CSP, and unsafe `postMessage`/origin handling.
- File uploads: validate type/size, store outside the web root or with safe content-type, and never trust the
  client-supplied filename or MIME.

## Secrets, configuration, and data exposure

- No secrets committed to the repo, embedded in client bundles/public env vars, or printed to logs/errors. Redact —
  report only the variable, file, and risk, never the value.
- Debug modes off in production paths; verbose stack traces and `dump`/`console.log`/`var_dump`-style leaks removed.
- Data leakage through over-broad API responses, serialization of server objects to the client, caches missing a
  per-user/per-tenant key, or revalidation that shares personalized data.

## Abuse, integrity, and dependencies

- Rate limiting / brute-force and replay protection on auth, reset, OTP, search, export, upload, and webhook
  endpoints; webhook signature verification.
- Idempotency and authorization on async/background work (jobs, queues, schedulers).
- New or changed dependencies: flag known-vulnerable or unexpected packages, install scripts, and lockfile changes
  that introduce a concrete exploitable condition.

## Reporting bar

A security finding must name a source, a sink or missing control, and a credible misuse scenario with application
impact. Do not report hypothetical issues without a reachable path; record genuinely uncertain concerns under
**Open Questions** instead.

## Primary references

- OWASP Top 10 — https://owasp.org/www-project-top-ten/
- OWASP ASVS — https://owasp.org/www-project-application-security-verification-standard/
- OWASP Cheat Sheet Series — https://cheatsheetseries.owasp.org/
- CWE Top 25 — https://cwe.mitre.org/top25/
