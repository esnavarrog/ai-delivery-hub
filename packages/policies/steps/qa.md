# Step: QA

## Purpose

Verify, after implementation, whether the plan's acceptance criteria are actually met by
running real checks and reporting what happened. Not wired to a runner in this phase — this
document defines the contract a future qa runner must satisfy. QA never certifies a pass
that was not observed.

## Inputs

- The approved `Plan`'s `acceptanceCriteria` and `tests`.
- The implemented code in the target repository.
- The repository's real test/build/typecheck commands.

## Output contract ("done" means)

One row per acceptance criterion, each with:

- The criterion id.
- The command or check that was run, or "not run" with a stated reason when it could not be.
- The actual observed result (command output, exit status, or the concrete behavior seen).
- A verdict: pass, fail, or unknown.

A qa pass is done only when every `acceptanceCriteria` id from the plan has a row. A
criterion with no mechanical way to check it is reported as a gap, never silently marked
pass.

## Rules

- Run the actual commands (tests, typecheck, build) rather than inferring behavior from
  reading the code.
- Keep "I read the code and it looks right" separate from "I ran it and observed this" —
  only the second counts as evidence for a pass.
- When a check cannot run (missing tooling, no access, out of scope), say so plainly instead
  of treating the gap as either a pass or a failure.
- A partial report — some criteria checked, others blocked — is still useful and should be
  returned as such, not withheld until everything can be checked.

## Anti-goals

- Do not fabricate a command result.
- Do not mark a criterion as passed based only on static reading of the code.
- Do not modify code or tests to make a check pass — a failing check is a finding to report,
  not a problem to quietly patch during qa.
