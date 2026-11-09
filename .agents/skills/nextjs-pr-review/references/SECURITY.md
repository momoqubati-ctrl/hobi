# Security Review Reference

Use this reference selectively. Review the changed attack surface and verify reachable paths rather than applying every item mechanically.

## Trust boundaries and entry points

Treat these as externally callable or attacker-influenced unless proven otherwise:

- App Router Route Handlers and Pages Router API routes.
- Server Actions/Server Functions, including actions invoked only from hidden UI.
- Middleware/proxy logic, rewrites, redirects, and authentication callbacks.
- Webhooks, cron endpoints, preview/draft endpoints, upload endpoints, and RPC/GraphQL handlers.
- Search params, route params, headers, cookies, form data, JSON bodies, file metadata, and external API responses.

For each privileged operation, verify authentication **and** authorization against the target resource. A logged-in user is not automatically allowed to act on every object ID they can submit.

## Input, output, and injection

- Validate on the trusted server using explicit schemas and bounds.
- Prefer allowlists for enums, sort keys, redirect destinations, MIME types, and supported protocols.
- Ensure ORM/query-builder escape guarantees are not bypassed by raw fragments.
- Track user data into HTML, SQL/NoSQL, shell commands, file paths, headers, templates, logs, and URLs.
- Review `dangerouslySetInnerHTML`, Markdown/HTML rendering, rich text, DOM sinks, and sanitization configuration.
- Prevent path traversal when file names or paths are user-controlled.
- Avoid `eval`, `new Function`, dynamic command construction, and unsafe deserialization.

## Next.js data boundaries

- Environment variables are server-only by default, but `NEXT_PUBLIC_*` values are bundled for the client.
- Inspect values passed from Server Components to Client Components and returned by Server Actions/Route Handlers.
- Use server-only boundaries for confidential data-access/business logic when appropriate.
- Treat Server Actions as directly POST-callable and enforce authorization inside the action — UI visibility is not a control. Validate the action's arguments as untrusted input.
- Prevent user-specific or tenant-specific data from entering shared caches without safe cache keys and invalidation. This applies to `'use cache'`, `cacheTag`/`revalidateTag`, and route segment caching.
- Verify revalidation does not expose stale authorization state or another user's result.
- In Next.js 15+, `cookies()`, `headers()`, `draftMode()`, `params`, and `searchParams` are async. Confirm auth/session reads actually `await` these; a forgotten `await` can yield a truthy promise and silently skip a check.
- Do not rely on middleware as the only authorization gate. Middleware is convenient for coarse redirects, but enforce real authentication and object-level authorization at the Route Handler, Server Action, or data-access layer. Confirm `matcher` config actually covers the protected paths.
- Keep authorization decisions close to the data (a data-access layer or `server-only` module) rather than scattered across components, so a missed check in one caller cannot bypass it.

## Browser and session security

- Cookies carrying sessions should use appropriate `HttpOnly`, `Secure`, `SameSite`, path, domain, and lifetime settings.
- State-changing operations should use appropriate methods and CSRF defenses for the architecture.
- Review CORS origins, credentials, methods, headers, and preflight behavior.
- Validate redirect targets to avoid open redirects.
- Use a deliberate CSP and security headers; do not recommend a nonce implementation without considering its rendering/cache cost.
- Avoid sensitive data in query strings, browser storage, analytics, logs, or client-visible error messages.

## External requests and files

- For server-side fetching of user-provided URLs, prevent SSRF using protocol/host allowlists, DNS/IP checks where appropriate, redirect limits, timeouts, and response-size limits.
- Verify webhook signatures against the raw payload, enforce timestamp/replay windows when supported, and fail closed.
- Validate upload size, content, extension, MIME/signature, storage key, access control, and serving headers.
- Use timeouts, abort signals, bounded retries, and safe error handling for external services.

## Abuse and operational controls

- Review login, reset, OTP, search, export, expensive query, upload, and webhook endpoints for rate/size limits.
- Ensure errors and logs do not contain secrets, tokens, personal data, SQL, stack traces, or internal infrastructure details.
- Review dependency changes only when evidence supports a reachable vulnerability or unsafe configuration. Do not invent CVE status without a trusted database result.

## Primary references

- Next.js Data Security: https://nextjs.org/docs/app/guides/data-security
- Next.js Authentication: https://nextjs.org/docs/app/guides/authentication
- Next.js Content Security Policy: https://nextjs.org/docs/app/guides/content-security-policy
- OWASP Application Security Verification Standard: https://owasp.org/www-project-application-security-verification-standard/
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- MITRE CWE: https://cwe.mitre.org/
