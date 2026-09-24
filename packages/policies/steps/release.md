# Step: Release

## Purpose

Keep each unit of delivered work small enough for a human to review in one sitting. This is
a size discipline applied at delivery time, not a separate workflow — it governs how the
commits produced by implement are grouped and reported, not what the code looks like. Not
wired to a runner in this phase.

## Inputs

- The commits produced during implement for one plan, or one plan slice.

## Output contract ("done" means)

- The changed-line count (additions + deletions, excluding generated files) for the unit
  being delivered.
- When that count is within the ~400-line guideline, the unit is reported as deliverable as
  one piece.
- When it is over, the work is split by deliverable behavior into slices, and each slice's
  report states what it depends on and what depends on it.
- Every slice must be independently revertible without breaking an earlier one.
- If, after one honest attempt to split by behavior, no cohesive split brings every slice
  under the guideline, the report states the actual line count and why it could not split
  further, rather than shrinking the diff artificially to hit the number.

## Rules

- Split by deliverable behavior, never by file type — "all models, then all services, then
  all tests" is not a valid split.
- Keep tests and docs in the same slice as the behavior they verify or explain.
- Never shrink a diff by deleting comments, blank lines, tests or docs just to fit under the
  guideline.
- The guideline bounds how work is sliced for review, never what the implementation itself
  has to contain.

## Anti-goals

- Do not treat ~400 lines as a hard reject that blocks delivery on its own — it is a
  review-load guideline the pipeline reports against.
- Do not produce a slice that cannot stand on its own (half a feature with no tests).
- Do not keep re-slicing past one honest attempt once no cohesive split remains — report the
  overage instead of looping indefinitely.
