# Step: Review

## Purpose

Give implemented work an independent, read-only check before it is delivered. Not wired to
a runner in this phase — this document defines the contract a future review runner (four
lenses plus one refuter) must satisfy. A reviewer only reports; it never fixes what it
finds, and it never expands its own scope.

## Inputs

- The diff (or patch set) for the work under review, scoped to what changed since the last
  reviewed point — never the whole repository history, and never live, uncommitted state.

## Output contract ("done" means)

Each lens returns a list of findings, and every lens must cover every changed file (an
empty findings list is a valid, complete result). Each finding needs:

- A location (`file:line` or `file:start-end`).
- A plain-language claim of what is wrong.
- A severity: `blocker` (no safe way to ship as-is), `critical` (a real, provable defect a
  user or operator would hit), `warning` (real but non-blocking), `suggestion` (optional).
- Concrete evidence tied to the diff — a defect proven to be introduced or made worse by
  this change, not general suspicion. A defect that already existed before the change is
  out of scope for blocking; flag it separately as pre-existing.

A review pass is done only once every lens has returned a result (findings or an explicit
empty list) for the full scoped diff — nothing silently skipped.

## Rules — the four lenses

- **risk** — authorization, data exposure, secret handling, unsafe input handling, and
  dependency vulnerabilities. Requires a reachable path, not a hypothetical one.
- **reliability** — whether the changed behavior is actually tested (not just touched),
  edge cases, determinism, and whether existing contracts/tests still hold.
- **readability** — names, duplication, dead code, and complexity that would make the
  change unsafe to maintain later. Style alone is not a finding unless it hides a real
  defect.
- **resilience** — failure handling, retries, graceful degradation, and whether operators
  would have what they need (logs, metrics) if this breaks in production.

A **refuter** role exists for findings whose evidence is inferential rather than a clear
before/after diff: it checks the claim against the actual diff and returns `corroborated`,
`refuted`, or `inconclusive`. It never adds new findings of its own.

## Anti-goals

- Reviewers never edit code and never fix what they find — that belongs to a separate
  follow-up step, not this one.
- Do not report a finding without a location and concrete evidence.
- Do not let the same underlying defect surface from multiple lenses as if independent.
- Do not let a readability nitpick alone block delivery.
