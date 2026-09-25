# Step: Implement

## Purpose

Turn one approved plan step (or a small, dependency-ordered group of them) into working
code in the target repository. Not wired to a runner in this phase of the pipeline — this
document defines the contract a future implement runner (or a human following the approved
plan) must satisfy so the rest of the pipeline can trust its output.

## Inputs

- The approved `Plan`: `goal`, the assigned `steps`, `filesTouched`, `tests` and
  `acceptanceCriteria`.
- A writable checkout of the target repository.
- The repository's resolved TDD mode (strict or standard) and its real test command, from
  `repos.yaml`.

## Output contract ("done" means)

For the assigned step(s):

- Every file listed under `filesTouched` for that step exists with the described change; no
  unrelated file changes without a stated reason.
- The tests named for that step pass when run with the repository's real test command — not
  "should pass", an observed pass.
- When the repository's TDD mode is strict, the change shows an observable
  RED (a failing test written first) → GREEN (the implementation makes it pass) → REFACTOR
  sequence, not a test written after the fact to match already-written code.
- The change lands as one or more commits, each a complete and independently revertible unit
  of behavior — never a commit per file type (all models, then all services, then all
  tests) — with its tests and any doc update alongside the behavior they cover, and a
  Conventional Commit message that explains the outcome, not the file list.

## Rules

- Implement only the assigned step(s); do not run ahead into later steps even if the change
  looks small.
- Match the target repository's existing patterns (see `conventions.md`) before introducing
  a new one.
- Never start a step whose prerequisite steps (per the plan's ordering) are still open.
- If real code contradicts the plan (a described file doesn't exist, an approach doesn't
  fit), stop and report the gap instead of silently implementing something different.

## Anti-goals

- Do not mark a step done without an actually observed test run for it.
- Do not bundle unrelated steps into one commit to save time.
- Do not touch files outside `filesTouched` without recording why.
- Do not skip a test to move faster, even under time pressure — an unverified step is not a
  completed step.
