# Clean code reference (stack-agnostic)

Judge the change by how easy it is to read, change safely, and test. Report maintainability issues that create real
correctness or change-cost risk — not style preferences. Explain the consequence, not just the rule. Do not enforce
arbitrary limits such as maximum line counts.

## Intent and naming

- Names reveal intent and match the domain; booleans and predicates read clearly; no misleading or abbreviated names.
- Follow the language's and the repository's existing conventions over personal preference.

## Cohesion and responsibility (SOLID)

- Each function/class/module has one coherent purpose; flag "god" units that mix HTTP, domain logic, persistence, and
  formatting.
- Correct separation of concerns (presentation / domain / data access / infrastructure) without inventing
  unnecessary layers or indirection.
- Dependencies point inward toward stable abstractions; avoid hidden global state and tight coupling that makes the
  unit hard to test.

## Functions and control flow

- Functions are at one level of abstraction; use guard clauses over deep nesting; keep parameter lists manageable.
- No hidden side effects; predictable return shapes; clear handling of every branch and edge case.

## Duplication and abstraction (DRY / KISS / YAGNI)

- Flag duplication that creates a real "change two places together" risk — but do not demand premature abstraction
  for incidental similarity.
- Prefer the simplest design that works; remove speculative generality, unused parameters, and dead options.

## Types, contracts, and errors

- Use the type system to make illegal states unrepresentable; flag unsafe casts, `any`/untyped escapes, and
  unchecked nullability.
- Errors are handled deliberately: meaningful types/messages, preserved context, resource cleanup, and sensible
  failure states — never swallowed silently.

## Comments, dead code, and hygiene

- Comments explain **why**, not what the code already says; remove stale or misleading comments.
- No leftover debug statements, commented-out blocks, dead code, magic numbers/strings, or accidentally committed
  scratch files.

## Tests

- New behavior, fixed bugs, authorization boundaries, and important failure cases have tests.
- Tests assert real behavior and avoid incidental coupling to implementation details. (For deeper test review, defer
  to a dedicated test-review pass.)

## LLM / generated-code failure modes (check explicitly)

AI-generated changes commonly introduce these — look for them when the diff was machine-written:

- Plausible-but-wrong API usage, invented function/option names, or signatures that do not exist in the installed
  version.
- Silent behavior changes, dropped edge cases, or altered error handling slipped into an unrelated refactor.
- Duplicated helpers that re-implement something already in the codebase or standard library.
- Over-engineered abstractions, needless config flags, and defensive code for impossible states.
- Hard-coded values, placeholder/sample data, or `TODO`s left in production paths.
- Comments that restate the code or describe intent the code does not actually implement.

## Primary references

- *Clean Code*, Robert C. Martin.
- *Refactoring*, Martin Fowler.
- *The Pragmatic Programmer*, Hunt & Thomas.
- SOLID / DRY / KISS / YAGNI principles, applied with judgment for the language at hand.
