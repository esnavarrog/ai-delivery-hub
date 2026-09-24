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
- [ ] T1 — OP read-only: remove outbox OP comment posting and `addComment`; guard test that the OP client has no write methods (route: delegated)
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

## Progress / Evidence
- Branch `feat/op-readonly-obsidian` created from `feat/ai-credentials-modes` (a5948f8).

## Next step
Delegate T1–T6 to one writer.
