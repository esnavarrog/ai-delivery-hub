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
- [ ] T2 — Manual fetch: drop webhook route + scheduled poll; add `POST /api/ingest/fetch` (OP pull) with contract in `packages/contracts`; config cleanup (route: delegated)
- [ ] T3 — Domain: manual ticket source (key `M-0001`…) alongside OP, through the same state machine (route: delegated)
- [ ] T4 — Obsidian inbox import: parse `hub/inbox/*.md` (frontmatter + body), ingest as manual tickets, move note to `hub/tickets/<key>.md`; wired into fetch (route: delegated)
- [ ] T5 — Obsidian mirror: write/update `hub/tickets/<key>.md` frontmatter on events, preserve user body (route: delegated)
- [ ] T6 — UI: Fetch button with summary + manual/OP source badge; README (route: delegated)

## Acceptance criteria
- No HTTP request other than GET is ever sent to OP.
- Nothing is ingested unless the Fetch button (or endpoint) is used.
- A note dropped in `hub/inbox/` becomes a triaged ticket after Fetch and appears mirrored in `hub/tickets/`.
- User text below the marker in a mirrored note survives every hub update.

## Open questions
- Terminal-state archiving/moving of mirror notes (e.g. out of `OBSIDIAN_TICKETS_DIR` once a ticket is `done`/`rejected`/etc.) is explicitly **not** implemented — not yet authorized. Mirror notes stay in place for every state, including terminal ones.

## Progress / Evidence
- Branch `feat/op-readonly-obsidian` created from `feat/ai-credentials-modes` (a5948f8).
- `.env.example` is outside this session's write permissions (Edit and Bash writes to it are both denied by the sandbox). README's Environment table was updated instead for every env var added/removed by this feature; `.env.example` itself is stale (still lists `HUB_PUBLIC_URL`/`OP_WEBHOOK_SECRET`/`POLL_INTERVAL_MS` and will not list the new `OBSIDIAN_*` vars). Flagged for the user to update by hand or in a follow-up session with write access.

## Next step
Delegate T1–T6 to one writer.
