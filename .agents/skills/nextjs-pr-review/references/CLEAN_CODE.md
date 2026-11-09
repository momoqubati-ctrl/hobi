# Clean Code Review Reference

Use these principles as context-sensitive heuristics, not rigid laws. Repository conventions, framework idioms, correctness, and clarity take priority over personal style.

## Review lenses

### Intent and naming

- Names should reveal domain intent and distinguish concepts without relying on comments.
- Boolean names should make true/false meaning clear.
- Avoid misleading names, unexplained abbreviations, generic containers, and overloaded terms.

### Cohesion and responsibility

- Keep code that changes for the same reason together.
- Separate UI rendering, business rules, data access, and infrastructure when that separation reduces coupling or improves testing.
- Avoid “god” components/hooks/services, but do not create one-file-per-function fragmentation.
- Prefer explicit data flow over hidden mutation and action at a distance.

### Functions and components

- A function/component should have a coherent purpose and a readable level of abstraction.
- Extract code when it creates a meaningful concept, removes risky duplication, or makes testing easier—not merely to reduce line count.
- Make side effects visible and keep render paths pure.
- Prefer guard clauses when they reduce nesting and preserve readability.

### Duplication and abstraction

- Report duplication when repeated logic can drift, must be fixed in multiple places, or encodes the same business rule inconsistently.
- Do not force unrelated code into a shared abstraction merely because it looks similar today.
- Prefer a small, stable interface over premature generalization and configuration-heavy helpers.

### Types and contracts

- Model meaningful states and variants explicitly.
- Validate external data at boundaries; TypeScript types alone do not validate runtime input.
- Flag unsafe assertions, broad `any`, non-null assertions, and partial objects when they can hide real failures.
- Keep API/schema/database types aligned without leaking infrastructure shapes through the entire UI.

### Errors and observability

- Handle expected failures at the correct layer.
- Preserve useful context without leaking secrets or personal data.
- Avoid swallowed errors, ambiguous fallbacks, duplicate user notifications, and catch blocks that only log and continue incorrectly.
- Ensure resources, listeners, timers, and subscriptions are cleaned up.

### Comments and documentation

- Comments should explain why, constraints, trade-offs, or surprising behavior.
- Remove comments that restate code, are stale, or preserve dead alternatives.
- Public utilities and complex business rules should document their contract where the repository expects it.

### Tests

- Test externally meaningful behavior and important failure paths.
- New authorization, validation, pricing, caching, and state-transition logic usually needs regression coverage.
- Avoid tests coupled to incidental implementation details when behavior-level assertions are possible.
- A missing test is a finding only when the change creates material regression risk or the repository policy requires it.

### React/Next.js quality

- Components and Hooks should be pure during render.
- Hook dependency arrays should reflect actual dependencies; avoid disabling lint rules without a justified alternative.
- Avoid duplicated derived state and synchronization Effects when values can be calculated from source state/props.
- Use stable semantic keys, clear server/client boundaries, and framework conventions appropriate to the installed version.
- Keep route-level error, loading, not-found, and empty states consistent when the change affects them.

## Literature and standards

The skill applies concepts inspired by these works without reproducing their copyrighted text:

- Robert C. Martin, *Clean Code: A Handbook of Agile Software Craftsmanship*, Prentice Hall.
- Martin Fowler, *Refactoring: Improving the Design of Existing Code*, 2nd edition, Addison-Wesley.
- Andrew Hunt and David Thomas, *The Pragmatic Programmer*, 20th Anniversary Edition, Addison-Wesley.
- Steve McConnell, *Code Complete*, 2nd edition, Microsoft Press.
- Eric Evans, *Domain-Driven Design*, Addison-Wesley, for domain boundaries where applicable.
- Dan Vanderkam, *Effective TypeScript*, O'Reilly, for practical TypeScript contracts and type safety.

Supporting official references:

- React Rules: https://react.dev/reference/rules
- TypeScript Handbook: https://www.typescriptlang.org/docs/handbook/intro.html
- Next.js Documentation: https://nextjs.org/docs
- Refactoring catalog and overview: https://refactoring.com/ and https://martinfowler.com/books/refactoring.html
