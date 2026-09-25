# Feature: spanish-ui

## Objective
Everything a reviewer reads to understand and approve work is in Spanish: the web UI copy and the AI-generated content (triage summary/signals, plan text, OpenProject-independent notes).

## Problem / Why
The user reviews and approves plans in Spanish. Today UI copy and AI output are English.

## Decisions (2026-09-24)
- User-explicit override of the default "artifacts in English" rule for **user-facing text only**: UI copy and AI-generated prose are Spanish (neutral/professional register, Chile-friendly, no voseo/regional slang).
- Stay English: code, identifiers, JSON keys, zod schemas, enum values, event names, logs, commit messages, tests' names, policy docs addressed to the model (they may instruct "write in Spanish").
- UI: no i18n library; a single typed `es` dictionary module (`apps/web/src/i18n/es.ts` or similar) so another locale can be added later. Enum values (states, risk tiers, categories, run failure reasons) render through Spanish label maps.
- Dates/numbers formatted with `es-CL`.
- AI content language set from policies (`repos.yaml`: `output.language: es`), injected into triage + planning system prompts; structured fields keep English keys, free-text values in Spanish.
- Obsidian mirror frontmatter keys stay English (machine-owned); the marker line gets Spanish text only if the parser keeps accepting existing notes (backward compatible).

## Scope
- T1 — Web: Spanish dictionary + replace all visible copy (header, dev auth, inbox incl. empty state describing Fetch + OP rule + Obsidian inbox, board, ticket timeline sentences, action panel/decision cards, plan review, runs, toasts, errors, keyboard hints). Spanish labels for enums. `es-CL` formatting. `<html lang="es">`. Tests updated.
- T2 — AI output language: policy setting + prompt instruction for triage and planning (both credential modes); tests assert the instruction is present. Step docs mention the output language.
- T3 — Obsidian mirror: Spanish human-facing text in the note (marker text kept backward compatible); README note.

## Constraints
- No behavior change beyond language. Contracts/schemas unchanged.
- Unit tests never touch network/Claude.

## TDD
Mode: strict (global config). Runner: `pnpm -r test`, `pnpm typecheck`, `pnpm build:web`.

## Tasks
- [x] T1 — Web UI copy in Spanish (route: delegated, writer trigger: many non-trivial files)
  - commit d3cd1cd — `feat(web): Spanish UI copy, labels and es-CL formatting`
  - Added `apps/web/src/i18n/{es.ts,labels.ts,index.ts}`: typed dictionary + enum label maps
    (ticket state/risk/category/role/flag/priority/actor/run status/run failure reason/run kind).
  - Replaced every user-visible string across Header, root, inbox (incl. empty state explaining
    Fetch/OP rule/Obsidian), board, plan (view/markdown/comments/version switcher), runs, ticket
    (header/timeline/action panel/dialogs/risk banner), toasts (queries.ts), shared ui primitives
    (state-chip, risk-badge, source-badge, flag-chips, actor-avatar, relative-time, dialog.tsx close).
  - `lib/format.ts`: `relativeTime` uses date-fns `es` locale; new `formatAbsolute()` uses `es-CL`;
    `formatCost` "n/a" -> "n/d". `index.html` `<html lang="es">`. Fetch button renamed "Traer tickets".
  - Keyboard shortcuts (j/k/Enter/a/r) unchanged; only their in-UI description is Spanish.
  - Checks: `pnpm --filter @ai-delivery-hub/web typecheck` pass; `pnpm --filter @ai-delivery-hub/web test`
    (vitest) 14 files / 64 tests pass; `pnpm build:web` pass.
  - RED evidence: updated test expectations to Spanish copy first and observed failures in
    format.test.ts, event-to-sentence.test.ts, action-resolver.test.ts, plan-view/plan-markdown,
    inbox/timeline/action-panel component tests, containers/inbox and containers/ticket-approve,
    then implemented sources until green.
  - Deviation: server-originated error messages (ApiError bodies from the API, e.g. "unknown user
    esteban; add it to repos.yaml roles", "plan has 1 unresolved comment(s)") are left in English —
    out of the mapped T1 file scope (they live in apps/server validation/domain code, not listed in
    the assignment's file map); flagged as an open question below.
- [x] T2 — AI output language es via policies (route: delegated)
  - commit 636c9a1 — `feat(policies,server): AI output language setting + prompt instruction`
  - `packages/policies/src/schema.ts`: `OutputLanguage` enum (`es`|`en`) + `OutputPolicy`
    (`language` defaults `es`), added to `ReposFile.output` via `.prefault({})`.
    `packages/policies/repos.yaml`: `output: language: es`.
  - `apps/server/src/adapters/agent/output-language.ts` (new): `buildOutputLanguageInstruction`
    shared by both triage runners (via `triage-prompt.ts`'s `buildTriageSystemPrompt`, used by
    both `AnthropicTriageRunner` and `ClaudeCodeTriageRunner`) and `AgentSdkPlanningRunner`.
    Removed the old hardcoded "in English" in `TRIAGE_ROLE_INSTRUCTIONS`.
  - `steps/triage.md` and `steps/planning.md`: new "Output language" section.
  - Checks: `pnpm -r typecheck` pass; `pnpm --filter @ai-delivery-hub/server test` 26 files/203
    tests pass (incl. new `output-language.test.ts` and new language-instruction assertions in
    triage-runner/claude-code-triage-runner/planning-runner tests); `pnpm --filter
    @ai-delivery-hub/policies test` 9 tests pass (incl. new default/override/rejection test).
  - RED evidence: added `output.language` assertions to policies.test.ts and
    `expect(policies.output.language).toBe('es')` before the schema had the field (`Cannot read
    properties of undefined`); added the three runner fixtures without `output` and re-ran to
    see `TypeError: Cannot read properties of undefined (reading 'language')` from
    `buildTriageSystemPrompt`/`buildSystemPrompt`, then implemented.
  - Smoke: `pnpm --filter @ai-delivery-hub/server smoke:triage` (subscription mode, developer
    logged in with `claude`) — real Claude Code run, ok:true, Spanish prose with unchanged
    English JSON keys/enum values:
    ```
    summary: "Se solicita corregir un error tipográfico en el archivo README.md, en la sección
      de inicio, donde aparece \"recieve\" en lugar de \"receive\". Es un cambio únicamente de
      documentación, sin impacto funcional ni en contratos de API."
    riskSignals: ["solo documentación", "sin impacto funcional"]
    category: "chore", riskTier: "low", targetRepo: "backend-parkingapp"  (unchanged, English enum values)
    ```
- [x] T3 — Mirror note Spanish text + README (route: delegated)
  - commit c53b137 — `feat(server): Spanish Obsidian mirror marker, backward compatible`
  - `apps/server/src/adapters/obsidian/mirror-note.ts`: `MIRROR_MARKER` is now the Spanish
    human-facing text `<!-- hub:notas — todo lo que sigue es tuyo -->`; a private
    `LEGACY_MIRROR_MARKER` keeps the old English text (`<!-- hub:notes — everything below is
    yours -->`). `extractUserContent` tries both markers in order, so existing notes keep
    parsing; every rewrite (`renderMirrorNote`) now writes only the Spanish one.
    Frontmatter keys/values (key, source, title, state, riskTier, targetRepo, updatedAt,
    hubUrl) are unchanged — machine-owned, stay English per the decision.
  - README: new "Output language" subsection under "AI runs" documenting `output.language`;
    "Web" section notes the UI copy is Spanish via `apps/web/src/i18n/`; Obsidian vault section
    updated to describe the Spanish marker and backward-compat with the old English one.
  - Checks: `pnpm --filter @ai-delivery-hub/server test test/unit/obsidian-mirror-note.test.ts
    test/unit/obsidian-mirror-hook.test.ts test/unit/obsidian-import-mirror-integration.test.ts`
    — 16/16 pass; full server suite 205 passed/10 skipped; `pnpm --filter
    @ai-delivery-hub/server typecheck` pass.
  - RED evidence (two-step, since this is dual-marker backward compat, not a pure copy swap):
    1. Added `expect(MIRROR_MARKER).toContain('notas')` — failed against the still-English
       marker (`AssertionError: expected '<!-- hub:notes...' to contain 'notas'`).
    2. Added a legacy-marker extraction test with a hardcoded old literal; after swapping
       `MIRROR_MARKER` to Spanish (no compat yet) it failed for real (`expected '<!-- hub:notes
       ... -->\nOld note text.\n' to be 'Old note text.\n'`), proving the regression it guards;
       then added `LEGACY_MIRROR_MARKER` fallback and both passed.

## Acceptance criteria
- No English user-visible string remains in the web app (spot-check every route).
- A triage/plan generated with the smoke script returns Spanish prose with unchanged JSON keys.
- Existing Obsidian mirror notes are still updated correctly.

## Review record
- Full range 26a3bca..3223713 refused at START with `lens_context_budget_exceeded` (no authority created); reviewed as three slices instead.
- Slice A (T1, 26a3bca..b58f6d9): medium, consent granted, 1 lens, approved + acknowledged. Follow-ups: `failureMessage` still humanizes run kind in English (`action-resolver.ts:84-86`); label lookups use `in` on plain objects (prototype keys match).
- Slice B (T2, b58f6d9..56defe9): high, consent granted, 4 lenses, approved + acknowledged. Follow-up: `riskSignals` are short tags with English examples but the language instruction asks to translate them — decide whether tags stay English.
- Slice C (T3, 56defe9..3223713): medium, consent granted, 1 lens, approved + acknowledged, no warnings.

## Progress / Evidence
- Branch `feat/spanish-ui` created from `feat/op-readonly-obsidian` (26a3bca).

## Next step
All three tasks implemented and committed (T1 d3cd1cd, T2 636c9a1, T3 c53b137). Remaining:
final full verification run (`pnpm typecheck`, `pnpm -r test`, `pnpm build:web`) and report.
Note: this dev machine showed high load (`uptime` load avg ~15, vitest worker startup 10-20s
instead of the usual <1s) during this session, making `apps/web`'s `pnpm -r test` run flaky
with 5s-timeout failures; the same web suite passes 64/64 reliably in isolation
(`cd apps/web && pnpm vitest run`) when the machine isn't under that load. Re-run `pnpm -r
test` when the machine is idle to get a clean combined result.
