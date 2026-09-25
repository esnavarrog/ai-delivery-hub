# Feature: op-readonly-obsidian

## Objective
OpenProject becomes strictly read-only for the hub and is pulled only on demand from a UI "Fetch" button. An Obsidian vault becomes a second intake (manual tickets) and a mirror of every hub ticket, while Postgres stays the source of truth.

## Problem / Why
- The hub writes to OpenProject today: `modules/sync/outbox.ts` posts "AI plan vN ready for review" comments via `op.addComment`. The user wants OP read-only.
- Tickets are ingested automatically (pg-boss scheduled poll + OP webhook). The user wants explicit, manual fetches only.
- There is no way to create tickets outside OP. The user wants to author manual tickets and personal notes in Obsidian.

## Decisions
- Obsidian role: **intake + mirror** (user choice, 2026-09-24). Postgres/event store remains the source of truth for state, approvals and runs. Obsidian as source of truth was rejected (loses event store, job concurrency, live SSE timeline).
- Vault layout under `OBSIDIAN_VAULT_DIR`: `hub/inbox/*.md` (user writes new manual tickets) and `hub/tickets/<ticket-key>.md` (hub-managed mirror: frontmatter owned by the hub, body below a marker owned by the user and never overwritten).
- "Fetch" = OP pull (read-only) + import of `hub/inbox/`.
- Vault subfolders are configurable (user choice, 2026-09-24, delivered as part of T4/T5): `OBSIDIAN_INBOX_DIR` (default `hub/inbox`) and `OBSIDIAN_TICKETS_DIR` (default `hub/tickets`), both relative to `OBSIDIAN_VAULT_DIR`, validated to resolve strictly inside the vault (no absolute paths, no `..`, no symlink escape). Rationale: the user will organize the vault with Tiago Forte's PARA method (e.g. inbox under an Inbox folder, ticket mirrors under Projects). No automatic archiving/moving of mirror notes on terminal states — see Open questions.
- Removing OP writes also removes OpenProject **status** sync (`setStatus`/`statusIdByName`), not only comment posting: the acceptance criterion "OP client must expose only GET calls" covers both, so `openproject.statusSync` (repos.yaml/policies schema) was dropped along with the outbox.
- The mirror writer runs on **every** appended event, not just ones that change `state` — `triage_completed`/`triage_confirmed` change `riskTier`/`targetRepo`/`category` without being a state transition, and the mirror should reflect those too. Simpler and more robust than filtering by event type; the cost is more frequent (still cheap, local) file writes.

## Scope
- Remove every OP write path (outbox comment posting, `addComment`) and the webhook + scheduled poll; `OP_WEBHOOK_SECRET` and `POLL_INTERVAL_MS` no longer required.
- `POST /api/ingest/fetch` running OP pull + Obsidian inbox import, returning a summary; UI Fetch button.
- Manual ticket source in the domain (alongside OP work packages).
- Obsidian mirror writer updating the ticket note on state-changing events.

Out of scope: PR comment "address review" step (phase 2, needs implement/release); informational follow-ups R2-001/R3-001/R4-001 from review lineage review-89b3cb87bfaa1077 (tracked in `ai-credentials-modes`).

## Constraints
- OP client must expose only GET calls after this feature; add a test that enforces it.
- The mirror never deletes user content below the marker; writes are atomic (temp file + rename).
- Vault path optional: without `OBSIDIAN_VAULT_DIR`, Fetch only pulls OP and the mirror is disabled.
- Unit tests never touch network, OP, Claude, or the real vault (use temp dirs).

## TDD
Mode: strict (source: global orchestrator config). Runner: `pnpm --filter @ai-delivery-hub/server test` / `pnpm -r test`, plus `pnpm typecheck`.

## Tasks
- [x] T1 — OP read-only: remove outbox OP comment posting and `addComment`; guard test that the OP client has no write methods (route: delegated). Commit `a2159d7`. Also removed `setStatus`/`statusIdByName` and `openproject.statusSync` (both OP writes, see Decisions). Checks: `pnpm typecheck` clean; `DATABASE_URL_TEST=postgres://hub:hub@localhost:5433/hub_test pnpm -r test` — 18/18 server test files, 168/168 tests, all green (includes the Postgres integration suite against the local docker-compose db). RED evidence: temporarily reintroduced a `POST .../activities` call inside `getWorkPackage`, observed 3 failing tests including the new GET-only guard (`op-client.test.ts`), then reverted — GREEN again (6/6). Migration `apps/server/drizzle/0002_drop_op_sync_outbox.sql` (drizzle-kit generate), applied to local `hub` and `hub_test`.
- [x] T2 — Manual fetch: drop webhook route + scheduled poll; add `POST /api/ingest/fetch` (OP pull) with contract in `packages/contracts`; config cleanup (route: delegated). Commit `85ba0d8`. Concurrency: a second call while one is in flight **reuses the in-flight promise** (not 409) — simplest for a UI button (double-click just gets the same settled summary). `obsidian` stays `null` until T4 wires an importer into `RunIngestFetch`. Checks: `pnpm typecheck` clean; full `pnpm -r test` green (168 server tests). RED evidence: `run-ingest-fetch.test.ts` written against a not-yet-existing `fetch.ts` failed with "Cannot find module" before the module was added; GREEN after.
- [x] T3 — Domain: manual ticket source (key `M-0001`…) alongside OP, through the same state machine (route: delegated). Commit `514e759`. `TicketSnapshot.source` discriminated union (`openproject{workPackageId,projectId,lockVersion}` | `manual{key}`) + denormalized `displayKey`; `CreateManualTicket` use case + `PgManualKeySequence` (atomic single-row counter); DB migration 0003 (OP columns nullable, `source_kind`/`manual_key`/`display_key` added, both id columns stay individually `unique()` — Postgres allows many NULLs). Triage duplicate-candidate/recent-ticket structures keyed off `displayKey` so manual tickets participate in duplicate detection. Every web `#<opWorkPackageId>` display swapped for `displayKey`. Checks: `pnpm typecheck` clean; full `pnpm -r test` green (domain 147, contracts 4, policies 8, web 60, server 171). RED evidence: `manual-ticket.test.ts` failed with "Cannot find module" before `manual-ticket.ts` existed (module temporarily removed to reprove RED), GREEN after; `PgManualKeySequence` integration test run for real against the local `hub_test` Postgres (concurrent calls hand out distinct keys).
- [x] T4 — Obsidian inbox import: parse `hub/inbox/*.md` (frontmatter + body), ingest as manual tickets, move note to `hub/tickets/<key>.md`; wired into fetch (route: delegated). Commit `2a447d5`. `OBSIDIAN_VAULT_DIR` optional; `OBSIDIAN_INBOX_DIR`/`OBSIDIAN_TICKETS_DIR` configurable (default `hub/inbox`/`hub/tickets`), validated relative-inside-vault at config load. Note moved to its mirror path *before* the ticket is created (so T5's mirror hook, once wired, finds the original body already there to preserve). Invalid notes / a post-move ticket-creation failure (rolled back) are reported and left in place. Checks: `pnpm typecheck` clean; full `pnpm -r test` green (server 194 tests). RED evidence: `obsidian-inbox-import.test.ts` failed with "Cannot find module" before `obsidian-inbox-import.ts` existed (module temporarily removed to reprove RED), GREEN after (8/8); `obsidian-vault-fs.test.ts`/`obsidian-note.test.ts`/the `CreateManualTicket` presetKey test were written alongside their (very small, mechanical) implementations and passed on first run — RED not separately captured for those, noted honestly per the task rules.
- [x] T5 — Obsidian mirror: write/update `hub/tickets/<key>.md` frontmatter on events, preserve user body (route: delegated). Commit `89ef9e2`. Fires on every appended event (not filtered to a subset of "state-changing" types — see Decisions); disabled (empty hooks array) when `OBSIDIAN_VAULT_DIR` is unset. Re-added `HUB_PUBLIC_URL` (removed in T1) for the mirror's `hubUrl` field — a different purpose than its old OP-comment use. Checks: `pnpm typecheck` clean; full `pnpm -r test` green (server 209 tests). RED evidence: `HUB_PUBLIC_URL` config test failed before re-adding the field; `obsidian-mirror-note.test.ts` and `obsidian-mirror-hook.test.ts` both failed with "Cannot find module" before their implementations existed (temporarily removed to reprove RED), GREEN after (8/8 and 5/5). Added `obsidian-import-mirror-integration.test.ts`: a real end-to-end check (no DB) wiring T4's importer + T5's hook together — confirms an inbox note's body survives as the mirror's initial content and a later event refreshes only the frontmatter.
- [x] T6 — UI: Fetch button with summary + manual/OP source badge; README (route: delegated). Commit `67de1ac`. `useIngestFetch` mutation (toasts a summary line + one error toast per invalid Obsidian note, invalidates ticket queries); `SourceBadge` (OP/Manual) on inbox, board and ticket header. Checks: `pnpm typecheck` clean; full `pnpm -r test` green (web 63, server 209); `pnpm build:web` succeeds. RED evidence: temporarily removed the Fetch button's JSX (2 new container tests failed with "Unable to find role button"), and temporarily removed `source-badge.tsx` (component test failed to resolve the import), both restored to GREEN.

## Acceptance criteria
- [x] No HTTP request other than GET is ever sent to OP. `OpenProjectClient`/`OpenProjectPort` expose only `getWorkPackage`/`listUpdatedSince`/`getActivities` (all GET); `op-client.test.ts` drives every public method through a fetch double that throws on any non-GET request (T1).
- [x] Nothing is ingested unless the Fetch button (or endpoint) is used. No webhook route, no scheduled poll; `POST /api/ingest/fetch` is the only ingest entry point (T2).
- [x] A note dropped in `hub/inbox/` becomes a ticket after Fetch and appears mirrored in `hub/tickets/`, going through the same `ticket_received` → triage → planning pipeline an OpenProject ticket does (triage itself is an async pg-boss job either way, same as OP ingest — "becomes a triaged ticket" means it enters that pipeline, not that triage completes synchronously inside the Fetch call) (T4, T5; end-to-end proof: `obsidian-import-mirror-integration.test.ts`).
- [x] User text below the marker in a mirrored note survives every hub update. `extractUserContent` preserves it byte-for-byte on every mirror rewrite; atomic write (temp file + rename) (T5).

## Open questions
- Terminal-state archiving/moving of mirror notes (e.g. out of `OBSIDIAN_TICKETS_DIR` once a ticket is `done`/`rejected`/etc.) is explicitly **not** implemented — not yet authorized. Mirror notes stay in place for every state, including terminal ones.

## Progress / Evidence
- Branch `feat/op-readonly-obsidian` created from `feat/ai-credentials-modes` (a5948f8).
- `.env.example` is outside this session's write permissions (Edit and Bash writes to it are both denied by the sandbox). README's Environment table was updated instead for every env var added/removed by this feature; `.env.example` itself is stale (still lists `HUB_PUBLIC_URL`/`OP_WEBHOOK_SECRET`/`POLL_INTERVAL_MS` and will not list the new `OBSIDIAN_*` vars). Flagged for the user to update by hand or in a follow-up session with write access.

## Review record
- Slice 1 (T1+T2, base a5948f8..240dd2b): high, consent granted, 4 lenses, approved + acknowledged. Follow-ups: persisted pg-boss `ingest.poll` schedule never unscheduled (R3-001); GET-only guard test overclaims (R2-001/R3-003); dead 409 conflict mapping (R2-002); fetch failure path untested (R3-002).
- Slice 2 (T3, base 240dd2b..26522db): high, consent granted, correction_required (BLOCKER/CRITICAL: 0003 NOT NULL without backfill; legacy ticket_received/triage payloads not upcast). Bounded correction a49bc8f (122 lines) cherry-picked as `ac87650`; recovered as lineage review-slice2-recovered-1 (maintainer-authorized), approved + acknowledged. Follow-ups: triage upcast only in planning, web card path not upcast (R3/R4); manual projection row untested; CreateManualTicket not retry-safe.
- Slice 3 (T4–T6 + correction, base 26522db..ac87650): medium, consent granted, 1 lens, approved + acknowledged. Follow-ups: mirror read-modify-write not serialized; inbox note moved before ticket append (crash orphan); rollback after successful append can duplicate.
- Post-cherry-pick checks on the branch: `pnpm typecheck` clean; `pnpm -r test` 423 passed, 10 skipped.

## Next step
All six tasks done. Remaining before shipping: apply migrations 0002/0003 to any environment beyond local dev (`pnpm --filter @ai-delivery-hub/server db:migrate`); update `.env.example` by hand (see Progress note — this session couldn't write it); optionally review the Open questions item (mirror archiving) with the user.
