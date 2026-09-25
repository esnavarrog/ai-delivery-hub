# Feature: feature-requests

## Objective
Non-dev staff (support, operations, finance) submit feature requests from a dedicated web route. An AI triage evaluates each request from three lenses (functional analyst, senior dev, dev manager), proposes RICE scores and asks the requester clarifying questions; a lead/admin confirms before anything enters planning/development.

## Problem / Why
Today tickets only enter via OpenProject or the Obsidian vault import. There is no web intake for business users, triage produces no business-value/cost scoring, and there is no pre-plan channel to ask the requester for missing information (plan comments require a plan version; `needs_info` is a flag that never changes state).

## Decisions (2026-09-24, accepted by user)
- **Extend the existing ticket, no parallel entity.** Feature requests are `manual` tickets with a structured `intake` in the `ticket_received` payload. Reuses event sourcing, projections, SSE, action-resolver, triage pipeline.
- **Roles:** reuse existing `requester` for submitters; "dev admin" = existing `lead`/`admin`. Department (support/operations/finance/other) is a ticket attribute, not a role. Real users/roles come later; Phase 1 dev auth (`X-Hub-User` + `repos.yaml`) stays.
- **Problem-first intake:** problem, who is affected, frequency, current workaround, expected outcome, success metric (optional), deadline + reason (optional), department.
- **Three-lens triage output** (optional `assessment` on `TriageResult`, backward compatible):
  - functional: clarity (1–5), draft acceptance criteria, questions for the requester
  - technical: feasibility (feasible/uncertain/infeasible), risks, dependencies
  - management: value (1–5), reach (1–5), confidence (0.5/0.8/1), effort (S/M/L/XL), recommendation (approve/reject/needs_info), rationale
- **RICE priority** = value × reach × confidence / effortWeight (S=1, M=2, L=4, XL=8). Pure domain function.
- **AI suggests, human decides:** lead/admin confirms or overrides scores via the extended confirm-triage flow.
- **Clarification loop:** new state `awaiting_requester`. Triage with open questions (and rounds < 2) moves the ticket there; requester answers → re-triage with answers as context. Max 2 rounds (`MAX_CLARIFICATION_ROUNDS = 2`), then a human decides.
- **Routes:** `/solicitudes/nueva` (form), `/solicitudes` (my requests + pending questions), `/inbox` restricted to lead/admin. Server enforces access; client gating is cosmetic only.
- Code/identifiers/JSON keys English; user-visible copy Spanish via `apps/web/src/i18n/es.ts` (spanish-ui convention).
- Worktree `../ai-delivery-hub-worktrees/feature-requests`, branch `feat/feature-requests` from `feat/spanish-ui` (b58f6d9). The uncommitted spanish-ui T2 work in the main checkout is left untouched.

## Scope / Tasks
- [x] T1 — Domain: `ManualIntake` + department, `awaiting_requester` state, clarification events (questions asked / answers submitted) with guards and round limit, `TriageResult.assessment`, `riceScore()`, confirm-triage score overrides. Tests first. (route: delegated — writer trigger, several non-trivial domain files)
  - Design: `triaging --requester_questions_asked(ai, round<2)--> awaiting_requester --requester_answers_submitted(requester owner | lead/admin)--> triaging`. No pre-existing retriage edge existed, so answers re-enter `triaging`. Snapshot gains `department?`, `requesterUserId?`, `clarificationRound`, `pendingQuestionCount`, `value/reach/confidence/effort/riceScore`; RICE set on `triage_completed` from `assessment.management`, overridable by `triage_confirmed.scores`. Added `awaiting_requester` label in `apps/web/src/i18n/labels.ts` (exhaustive record).
  - RED: 23 failed / 151 passed (missing new surface) → GREEN 187/187.
  - Checks: `pnpm --filter @ai-delivery-hub/domain test` 187/187 pass (re-run by parent); `pnpm -r typecheck` pass (re-run by parent).
  - Known pending red (intentional signals, not bugs): `apps/server/test/unit/structured-output.test.ts` (AI wire schema lacks `assessment` → T3); `apps/web/test/lib/action-resolver.test.ts` invariant (no UI action for `requester_answers_submitted` → T4). Environmental: `apps/server/test/unit/config.test.ts` fails in any worktree whose path is not `ai-delivery-hub/.worktrees` (pre-existing, same on clean tree).
  - Commits: 0461f34 (feat), 2fbd338 (docs). Review: assessed medium (slice_budget_reached, 668 lines) → consent granted → 1 lens (reliability) approved, acknowledged, lineage `review-05c2a2503e7d9db6`. Reviewed boundary → 2fbd338.
  - Advisory findings (non-blocking): WARNING `reduce.ts:70-72` clarificationRound trusted from payload (a repeated `round: 1` bypasses the cap); SUGGESTION `transitions.ts:136-144` answers round not checked against the current round; SUGGESTION missing round-invariant tests → folded into T2.
- [x] T2 — Server: `POST /api/tickets` (create manual request with intake; requester/lead/admin), `POST /api/tickets/:id/answers`, requester sees only own tickets in list/detail, `/api/tickets` full list lead/admin only. **Also:** carry `intake` in the manual `ticket_received` payload and set `department`/`requesterUserId` in `initialSnapshot` (T1 left these unset). **Also (T1 review follow-up):** guard `requester_questions_asked` so `payload.round === clarificationRound + 1` and `requester_answers_submitted` so `payload.round === clarificationRound`, with invariant tests. (route: delegated)
  - Commit c964a77. Routes: `POST /api/tickets` {title, description, intake} (requester/lead/admin → 201, else 403; login → requesterUserId; enqueues triage); `POST /api/tickets/:id/answers` {round, answers[]} (domain-guarded, 409 on deny, re-enqueues triage); requester scoping via `assertTicketVisible` on list/detail/plan/events stream (404 on others' tickets); `GET /api/runs` and `/api/runs/:id` → 403 for requester. Migration `0004_even_mimic.sql` (additive: department, requester_user_id + index). Round guards check `payload.round` (asked = current+1, answers = current); `submitAnswers` passes payload to the guard.
  - RED→GREEN per file (domain 3 fail→193/193; ingest 4 fail; commands 5 fail; http-app 12 fail + runs 403 test) → green.
  - Checks (re-run by parent): `pnpm --filter @ai-delivery-hub/server test` 219 pass / 2 known fail (config env, structured-output→T3); `pnpm -r typecheck` 5/5 pass.
  - Review: assessed medium (slice_budget_reached, 1344 lines incl. generated drizzle snapshot) → consent **declined** by user → ordinary checks (writer self-verification + parent spot check). Boundary → c964a77.
  - Open: unknown logins get 401 although `repos.yaml` comment says "defaults to requester" — left as is (future users/roles work).
- [x] T3 — Triage AI: three-lens prompt + output schema (fixes structured-output test), RICE computed server-side, answers fed into re-triage (a `triaging` state reached via `requester_answers_submitted` = retriage with answers as context), transition to `awaiting_requester` when questions remain — the AI path appending `requester_questions_asked` must pass `payload` to the guard so the round check applies. Unit tests with fake runner. (route: delegated)
  - Rebased onto feat/spanish-ui cbac28a before T3 (picks up AI output language); post-rebase SHAs: T1 12e6af5, docs 2bbfac0/bcbddb7, T2 c57c5bc, docs cf6fa77. All checks unchanged after rebase.
  - Commit 33723e1 (feat(triage)). Questions-round assessment persisted on the `requester_questions_asked` payload (T5 reads it from events). Checks (parent re-run): server 234 pass / 1 env fail (config); typecheck 5/5; structured-output now green.
  - Review: high (process_boundary in test fake runner) → consent granted → 4 lenses → approved, acknowledged lineage `review-7fab91809226296e`. Advisory: re-triage idempotency from `triaging` (3 lenses agree — duplicate job starts a 2nd run), >5 questions hard-fails (burns corrective retry), stale doc, magic number, routing vs recommendation clarity, re-triage failure untested → fixed in 1d6b747: `canReTriage(events)` skips when a triage `run_started` follows the last `requester_answers_submitted`; `MAX_CLARIFICATION_QUESTIONS = 5` with truncation in `triage-parse` (no retry burned); `pendingQuestions()` helper; +4 tests (RED observed: duplicate job returned `failed` instead of `skipped`). Checks: server 238 pass / 1 env; domain 195/195; typecheck 5/5. Assess 1d6b747: medium, 126 lines → `under_budget` (pending in slice, boundary stays 33723e1).
  - Known limitation (pre-existing parity): a run that crashes without `run_failed` leaves the ticket in `triaging`, same as first-leg triage today.
- [x] T4 — Web requester: `/solicitudes/nueva` form, `/solicitudes` list with state and pending questions, answer form (fixes action-resolver invariant). Spanish copy. (route: delegated)
  - Commit 1c13e40 (writer: web 72/72, typecheck, build). Assess vs 33723e1: medium, 934 lines → review due (held until browser QA fixes land, so review covers final code).
  - **Browser QA (2026-09-24, gstack $B, server :3100 + vite :5174 on docker Postgres `hub_test`, scratch policies with `finanzas.demo: requester`; real AI triage via subscription):**
    - BUG (fixed, uncommitted): `/solicitudes/nueva` rendered the list — `solicitudes.tsx` was a parent layout without `<Outlet/>`. Renamed to `solicitudes.index.tsx`; new `apps/web/test/app/route-tree.test.ts` (RED: parent `/solicitudes` ≠ `__root__` → GREEN). Component tests missed it because `renderApp` uses a synthetic router. Gotcha: a running vite dev server rewrites `routeTree.gen.ts` from stale in-memory state — stop it before regenerating.
    - BUG (fixed, uncommitted): list/detail showed "0 preguntas" — PG projection did not persist `clarificationRound`, `pendingQuestionCount`, RICE fields (memory helpers hid it). Migration `0005_burly_stranger.sql` + projection read/write + PG integration test (RED→GREEN). Writer's replay backfill on every `db:migrate` removed by parent (feature unreleased; would replay every OP ticket each migrate).
    - BUG (fixed, uncommitted): re-triage `budget_exhausted` (43,393 > 40,000 tokens). User chose `budgets.triage.maxTokens: 80000` (policies test RED→GREEN).
    - OK: requester redirect to `/solicitudes`; form submit → M-0001 `received` → real AI triage → `awaiting_requester` with 5 good Spanish business questions + assessment (value 4, reach 2, confidence 0.8, effort L, needs_info); answers dialog → POST answers 200 → re-triage started; `/api/runs` 403, others' ticket 404, unknown login 401.
    - Fixed (writer): timeline sentences for `requester_questions_asked`/`requester_answers_submitted`; manual `ticket_received` → "Solicitud recibida desde el formulario"; answers route 404 for non-owner requester (was 409).
    - Re-QA after fixes: M-0002 (requester) → round 1 (5 questions) → answers → re-triage refined (re-asked only the mis-answered point, 5 acceptance criteria, recommendation approve; ~22k tokens/run) → round 2 (1 question) → answer → cap reached → `triage_completed` → `awaiting_owner`, RICE 1.6 (4×2×0.8/4) ✓; stale round → 409 ✓; list badge "5 preguntas" ✓.
    - QA-fix commits: 5657a2c (web route + sentences), 9f20843 (projection + migration 0005 + answers 404), 95f36ea (budget 80k). Checks: web 77/77, domain 195/195, policies 9/9, server 249 incl. PG integration (1 env fail), typecheck 5/5, build ok.
    - Review: RDD found **off (global)** at preflight (`rdd_disabled`) — user-owned switch, not re-enabled. RDD-off path: assess 33723e1..95f36ea = high (process_boundary repos.yaml, 1985 lines) → writer self-verification + independent read-only verifier (running).
    - Observed, out of scope: a failed triage leaves the ticket in `received` with no auto-retry (pre-existing); requester still sees Bandeja/Tablero/Ejecuciones nav (T5).
- [x] T5 — Web lead: assessment card (three lenses + RICE) on ticket page, confirm dialog with score overrides, `/inbox` restricted to lead/admin, nav links by role. (route: delegated)
  - Commit d95a36b. `AssessmentCard` (three lenses + RICE via domain `riceScore`, AI-suggested vs human-confirmed badge, provisional during `awaiting_requester`); `ConfirmTriageDialog` score selects with live RICE, sends `scores` only when changed — server `confirmTriage` now passes `scores` through; requester nav hides Bandeja/Tablero/Ejecuciones and `/inbox` `/board` `/runs` redirect to `/solicitudes`; RICE badge on inbox cards. dev/qa keep dev views (existing review flow depends on dev; user asked "inbox only for dev admins" → lead/admin + dev, requester excluded).
  - Checks: web 100/100, server 239 / 1 env, typecheck 5/5, build ok. Writer stalled once (watchdog) and was resumed.
  - Browser QA: requester `/inbox` `/board` `/runs` → `/solicitudes` ✓, nav reduced ✓; admin inbox shows "RICE 1.6" ✓; M-0002 assessment card renders all three lenses with criteria, risks, dependencies, recommendation, rationale ✓. Found: "1 preguntas" plural, "Preguntas: Ninguno", `/runs` fires a 403 request before redirect → final fixes.
  - Independent verifier (RDD off, high tier) on 33723e1..95f36ea: FAIL with 1 blocker — `canReTriage` strands a ticket in `triaging` after an interrupted run (parent check: first-leg strand is pre-existing on base b58f6d9, re-triage leg is new) — plus pre-existing requester ownership gap on flags/comments routes. Both → final fixes (writer running): stale-run window (> maxDurationMs×2 ⇒ abandoned), `assertTicketVisible` on flags/comments/resolve.

## Constraints
- Backward compatible: existing events/tickets without intake/assessment keep working (optional fields, upcast if needed).
- Unit tests never touch network/Claude.
- ~400 authored lines per task is a planning heuristic only.

## TDD
Mode: strict (global config `Strict TDD Mode: enabled`). Runner: `pnpm --filter <pkg> test` (vitest), `pnpm typecheck`, `pnpm build:web`.

## Delivery
Forecast ~1500–2000 authored changed lines (> 400) → strategy `ask-on-risk`; chain strategy: `feature-branch-chain` (user choice 2026-09-24) — task PRs target `feat/feature-requests`, one final PR to the base.

## Acceptance criteria
- A requester can submit a request from `/solicitudes/nueva` and see it in `/solicitudes`.
- Triage produces the three-lens assessment with a RICE score; open questions put the ticket in `awaiting_requester`.
- Requester answers trigger re-triage; after 2 rounds no more questions are asked.
- A lead/admin sees the assessment, can override scores and confirm; requesters cannot open `/inbox` nor list others' tickets (server-enforced).

## Progress / Evidence
- 2026-09-24: worktree + branch created, `pnpm install` ok, codegraph initialized.

## Next step
Land final fixes, re-verify, then final PR `feat/feature-requests` → base (user decision).
