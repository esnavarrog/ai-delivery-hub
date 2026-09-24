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
- [ ] T2 — Server: `POST /api/tickets` (create manual request with intake; requester/lead/admin), `POST /api/tickets/:id/answers`, requester sees only own tickets in list/detail, `/api/tickets` full list lead/admin only. **Also:** carry `intake` in the manual `ticket_received` payload and set `department`/`requesterUserId` in `initialSnapshot` (T1 left these unset). **Also (T1 review follow-up):** guard `requester_questions_asked` so `payload.round === clarificationRound + 1` and `requester_answers_submitted` so `payload.round === clarificationRound`, with invariant tests. (route: delegated)
- [ ] T3 — Triage AI: three-lens prompt + output schema (fixes structured-output test), RICE computed server-side, answers fed into re-triage (a `triaging` state reached via `requester_answers_submitted` = retriage with answers as context), transition to `awaiting_requester` when questions remain. Unit tests with fake runner. (route: delegated)
- [ ] T4 — Web requester: `/solicitudes/nueva` form, `/solicitudes` list with state and pending questions, answer form (fixes action-resolver invariant). Spanish copy. (route: delegated)
- [ ] T5 — Web lead: assessment card (three lenses + RICE) on ticket page, confirm dialog with score overrides, `/inbox` restricted to lead/admin, nav links by role. (route: delegated)

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
T2 server (delegated writer).
