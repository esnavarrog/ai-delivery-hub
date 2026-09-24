# AI Delivery Hub

Turns OpenProject work packages into AI-triaged, AI-planned, human-approved delivery tickets.
An event-sourced ticket state machine drives every step; humans own approvals and risk decisions.
Phase 1 covers intake, triage and plan review; implementation and QA phases come later.

## Layout

- `packages/domain` — pure domain: ticket state machine, events, triage/plan schemas, ports (zero I/O).
- `packages/contracts` — HTTP API contracts (zod request/response schemas + inferred types) shared by server and web.
- `packages/policies` — `repos.yaml`, `risk-paths.yaml`, the pillars/conventions/security docs injected into every AI run, and `steps/*.md` — one policy doc per pipeline step (see "Step policies" under "AI runs").
- `apps/server` — orchestration service: OpenProject ingest, event store, pg-boss jobs, AI runs, HTTP/SSE API.
- `apps/web` — review UI (Vite + React): inbox, board, ticket timeline with action panel, plan review, runs.
- `infra` — `docker-compose.yml` with Postgres 16 (`hub` + `hub_test` databases).

## Getting started

```sh
pnpm i
docker compose -f infra/docker-compose.yml up -d
cp .env.example .env            # fill OP_* values; see "Environment" below
pnpm --filter @ai-delivery-hub/server db:migrate
DATABASE_URL=postgres://hub:hub@localhost:5433/hub_test pnpm --filter @ai-delivery-hub/server db:migrate
pnpm typecheck && DATABASE_URL_TEST=postgres://hub:hub@localhost:5433/hub_test pnpm test
pnpm --filter @ai-delivery-hub/server dev
```

Integration tests run only when `DATABASE_URL_TEST` is set; unit tests never touch the network, OpenProject or Claude.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Postgres connection (`postgres://hub:hub@localhost:5433/hub` locally). |
| `DATABASE_URL_TEST` | tests only | — | Enables the Postgres integration tests. |
| `OP_BASE_URL`, `OP_API_KEY` | yes | — | OpenProject REST v3, read-only (basic auth `apikey:<key>`). |
| `POLICIES_DIR` | no | `packages/policies` | Folder with `repos.yaml`, `risk-paths.yaml`, `*.md`. |
| `PORT` | no | `3000` | HTTP port (`.env` uses 3100). |
| `ANTHROPIC_API_KEY` | see below | — | Claude API key; required when `AI_CREDENTIALS` resolves to `api-key`, otherwise optional (used only to decide `auto`). |
| `AI_CREDENTIALS` | no | `auto` | Credentials mode for triage + planning: `auto` (`api-key` when `ANTHROPIC_API_KEY` is set, else `subscription`), `subscription` (always use the logged-in Claude Code session; strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from the agent subprocess env), or `api-key` (always use `ANTHROPIC_API_KEY`; startup fails with a clear error if it is empty). **Subscription mode is for personal/dev use only — production and multi-user deployments must use `api-key`** (Anthropic's terms). **Enforced**: when `NODE_ENV=production`, startup fails unless `AI_CREDENTIALS` resolves to `api-key` (`auto` without a key and explicit `subscription` both refuse to start). Outside production, `auto` falling back to `subscription` logs one warn-level line. |
| `WORKTREES_DIR` | no | `<repo-root>/.worktrees` | Bare git mirrors + detached read-only checkouts for planning (gitignored). |
| `OBSIDIAN_VAULT_DIR` | no | unset | Root of an Obsidian vault; see "Obsidian vault" below. Unset: Fetch only pulls OpenProject and the mirror writer is disabled. |
| `OBSIDIAN_INBOX_DIR` | no | `hub/inbox` | Where manual-ticket notes are read from, relative to `OBSIDIAN_VAULT_DIR`. Must stay inside the vault (no absolute path, no `..`). |
| `OBSIDIAN_TICKETS_DIR` | no | `hub/tickets` | Where the hub-managed ticket mirror notes live, relative to `OBSIDIAN_VAULT_DIR`. Same path constraints. |
| `CLAUDE_CODE_PATH` | no | SDK lookup | Explicit path to the Claude Code binary used by the Agent SDK. |

`.env` at the repo root is loaded automatically outside production (`apps/server/src/local-env.ts`).

## AI runs

Two separate runs, both configured in `packages/policies/repos.yaml`. Which credentials they use is controlled by `AI_CREDENTIALS` (see "Environment" above), resolved once at startup and logged as `aiCredentialsMode` (the key itself is never logged):

- **Triage, `api-key` mode** (`apps/server/src/adapters/agent/triage-runner.ts`, `AnthropicTriageRunner`) — one non-streaming `messages.create` call through `@anthropic-ai/sdk` with structured output (`output_config.format` built from the zod `TriageResult` schema, `targetRepo` bound to the repos in `repos.yaml`). Model `models.triage` (default `claude-opus-5`, thinking left on its default), `output_config.effort` from `models.effort.triage` (default `low`). Budget `budgets.triage`: the call is aborted at `maxDurationMs`, and usage above `maxTokens` fails the run with `budget_exhausted`. Invalid JSON or schema violations are retried once with the validation error fed back, then `invalid_output`. A `refusal` stop reason or an SDK error is `provider_error`.
- **Triage, `subscription` mode** (`apps/server/src/adapters/agent/claude-code-triage-runner.ts`, `ClaudeCodeTriageRunner`) — the same system prompt, policies, model/effort and structured-output schema (shared with `AnthropicTriageRunner` via `triage-prompt.ts`), but run through `query()` from `@anthropic-ai/claude-agent-sdk` instead of the Messages API: `tools: []`/`allowedTools: []` (no tool use at all — this is a classification, not an exploration), `permissionMode: 'dontAsk'`, `settingSources: []`, no session persistence, `maxTurns` capped at 2, and `outputFormat: {type: 'json_schema', ...}` read back from the result message's `structured_output` field. Same retry-once/budget/error-mapping semantics as the API-key runner.
- **Planning** (`apps/server/src/adapters/agent/planning-runner.ts`, `AgentSdkPlanningRunner`) — a `query()` from `@anthropic-ai/claude-agent-sdk` running Claude Code as a library with `cwd` set to a detached, read-only worktree of the target repository. Tools are limited to `Read`, `Grep`, `Glob` and `Bash(git log|show|blame|diff:*)` with `permissionMode: 'dontAsk'` (anything else is denied), `settingSources: []` (the target repo's `CLAUDE.md`/settings are not loaded), no session persistence, and a filtered environment (`PATH`, `HOME`, locale, `ANTHROPIC_*`, `CLAUDE_*` only; hub secrets never reach the agent). Model by risk tier from `models.planning`, effort `models.effort.planning` (default `high`), `maxTurns` from `budgets.planning.maxTurns` (default 40), abort at `maxDurationMs`. The final assistant text must contain one JSON object matching the `Plan` schema; `baseCommitSha` is always set to the worktree HEAD. One retry on invalid output (a fresh query), then `invalid_output`. Token usage and `total_cost_usd` are stored on the `runs` row.

In `subscription` mode, both agent-SDK-backed runners strip `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the Claude Code subprocess env (`agentSubprocessEnv(..., { stripApiKeyEnv: true })` in `planning-runner.ts`, reused by the triage runner) so the CLI falls back to its logged-in profile instead of accidentally billing the API key. **Subscription mode is for personal/dev use only; production and multi-user deployments must run with `AI_CREDENTIALS=api-key`** (Anthropic's terms).

Prompt assembly follows the security rules: system prompt = role instructions + policies; every external text (ticket subject/description, recent tickets for duplicate detection, plan comments) goes into the user turn wrapped by `wrapUntrusted(...)` and is never placed in the system prompt.

### Step policies

`packages/policies/steps/{triage,planning,implement,review,qa,release}.md` document each hub pipeline step: purpose, inputs, an output contract stated so it can be checked mechanically, rules and anti-goals. `loadPolicies` reads them into `policies.docs.steps` (`PoliciesError` if any is missing). Only the `triage` and `planning` docs are injected into a runner's system prompt today (both triage runners and `AgentSdkPlanningRunner`, right after the role instructions); `implement`, `review`, `qa` and `release` are loaded and validated but have no runner yet — they document the contract a later phase implements against. These docs are adapted from [Gentle AI](https://github.com/Gentleman-Programming/gentle-ai)'s SDD/review skills (MIT-licensed) for this headless pipeline; see `packages/policies/steps/NOTICE.md` for the attribution.

### Requirements on the server host

- Node 24 and git 2.20+ (`git worktree`).
- Claude credentials: export `ANTHROPIC_API_KEY` for `api-key` mode, or log in once with the Claude Code CLI (`claude` / `ant auth login`) for `subscription` mode; `AI_CREDENTIALS=auto` (the default) picks whichever applies. Both SDKs resolve credentials from the environment.
- The Agent SDK spawns the Claude Code CLI. The npm package ships a platform binary (`@anthropic-ai/claude-agent-sdk-<platform>`) that `pnpm install` pulls in; if the host needs a specific binary, install Claude Code (`claude --version` must work) and point `CLAUDE_CODE_PATH` at it.
- Network access to the git remotes in `repos.yaml` (SSH keys or HTTPS credentials for the user running the server). Mirrors live under `WORKTREES_DIR/mirrors`, worktrees under `WORKTREES_DIR/worktrees` and are removed after each run.

## Web

`apps/web` is the review UI (Vite 8, React 19, TanStack Router + Query, Tailwind v4, shadcn/ui). It talks to the server only through `packages/contracts` types.

```sh
pnpm dev:web                      # http://localhost:5173, proxies /api -> http://localhost:3100
pnpm --filter @ai-delivery-hub/web test
pnpm build:web                    # tsc --noEmit + vite build -> apps/web/dist
```

Screens: `/inbox` (tabs "Waiting on you" from `?waitingOn=me` and "Watching"; `j`/`k`/`Enter`; a "Fetch" button runs `POST /api/ingest/fetch` and toasts the summary), `/board` (kanban by state, filters repo/owner/risk), `/tickets/:id` (timeline as sentences with live SSE updates and a 5 s polling fallback; one decision card per state and role; `a` approve, `r` request changes), `/tickets/:id/plan` (versions, inline section comments, resolve, compare with the previous version), `/runs` (tokens, cost, duration, failure reason). The inbox, board and ticket header each show a source badge (`OP` / `Manual`) next to the ticket's display key.

Auth is the Phase 1 development header: the header shows a clearly labelled "dev auth" switcher; the chosen login is persisted in `localStorage` and sent as `X-Hub-User` (and `?hub_user=` on the SSE stream). Environment (`apps/web/.env.example`):

| Variable | Purpose |
| --- | --- |
| `VITE_OP_BASE_URL` | OpenProject base URL for the work package link in the ticket header. |
| `VITE_DEV_USERS` | `login:role,login:role` offered in the switcher; a free-text login is always possible. Roles come from `repos.yaml`. |

Layout (`apps/web/src`): `app/` (router, query client, API client, current-user store, SSE hook), `routes/` (file based, generated `routeTree.gen.ts`), `features/<screen>/` (containers fetch, presentational components render), `ui/` (shadcn atoms plus `StateChip`, `RiskBadge`, `ActorAvatar`, `EmptyState`, `RelativeTime`), `lib/` (pure logic: `action-resolver`, `event-to-sentence`, inbox sorting, plan diff). The UI never decides on its own which transitions are legal: `lib/action-resolver.ts` mirrors `packages/domain` for presentation and the server answers `403`/`409` with the domain reason, shown as a toast.

## Ticket lifecycle (Phase 1)

`received → triaging → triaged → awaiting_owner → planning → plan_review → plan_approved`, with `plan_review → plan_changes_requested → planning` for re-plans and `rejected | duplicate | already_implemented` as human decisions. A failed triage returns to `received` (re-triage from the UI); a failed planning run lands in `plan_changes_requested` (re-plan or reject). `triage_confirmed` is a state-keeping event a developer records when confirming or overriding the AI triage (category, risk tier, target repo). Every AI attempt writes a `runs` row (tokens, cost, duration, failure reason) and `run_started` / `run_succeeded` / `run_failed` / `budget_exhausted` events.

## HTTP API

Auth (Phase 1, development only): send the GitHub login in `X-Hub-User`; the role comes from `repos.yaml` → `roles` and unknown logins get `401`. `EventSource` cannot set headers, so the SSE endpoint also accepts `?hub_user=<login>`. GitHub OAuth replaces this header in a later step. Errors are `{ "error": { "code", "message" } }` with `400 | 401 | 403 | 404 | 409`; request/response schemas live in `packages/contracts`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | no auth |
| GET | `/api/me` | `{ login, role }` |
| GET | `/api/tickets?state=&repo=&owner=&waitingOn=me` | `waitingOn=me`: owner in `plan_review`/`plan_changes_requested`, any dev/lead/admin in `awaiting_owner`, lead/admin in `triaged` |
| GET | `/api/tickets/:id` | snapshot, events, latest plan summary, unresolved comment count, latest run |
| GET | `/api/tickets/:id/plan` | all plan versions (structured + markdown) and comments |
| GET | `/api/tickets/:id/events/stream` | SSE `ticket_event` messages, `?after=<seq>` |
| POST | `/api/ingest/fetch` | manual, on-demand ingest (see "Ingest" below); `{ openproject: { fetched, created, updated }, obsidian: { imported, skipped, errors } \| null }` |
| POST | `/api/tickets/:id/claim` | dev claims; enqueues planning |
| POST | `/api/tickets/:id/confirm-triage` | body `{ category?, riskTier?, targetRepo? }` |
| POST | `/api/tickets/:id/request-changes` | body `{ reason? }`; needs a reason or an unresolved comment |
| POST | `/api/tickets/:id/approve` | body `{ secondApproverId?, note? }`; high risk needs a distinct second approver |
| POST | `/api/tickets/:id/reject` · `duplicate` · `already-implemented` · `reopen` | body `{ reason? }` (`duplicate` also `duplicateOfTicketId?`) |
| POST | `/api/tickets/:id/retriage` | from `received` after a failed triage |
| POST | `/api/tickets/:id/replan` | from `plan_changes_requested`; enqueues planning |
| POST | `/api/tickets/:id/flags` | body `{ flag, set, reason? }` (`blocked`, `needs_info`, `paused`, `stale_plan`) |
| POST | `/api/tickets/:id/comments` | body `{ sectionPath, body, planVersionId? }` → `201 { ticket, comment }` |
| POST | `/api/tickets/:id/comments/:commentId/resolve` | |
| GET | `/api/runs?ticketId=` · `/api/runs/:id` | agent runs with tokens, cost, status |

## Ingest

Nothing is ingested automatically: there is no OpenProject webhook and no scheduled poll. `POST /api/ingest/fetch` is the only intake path, driven by the "Fetch" button in the web UI. One call pulls every configured OpenProject project (`pollOnce`, watermark-based, same idempotent ingest as before) and, when `OBSIDIAN_VAULT_DIR` is set, imports the Obsidian inbox (see "Obsidian vault" below). A call made while a fetch is already running reuses that same in-flight run and returns its summary instead of starting a second pass or answering `409`.

## OpenProject

The hub only ever reads from OpenProject (`GET` requests: work packages, listings, activities). It never posts comments or changes a work package's status — `OpenProjectClient` has no write method, and a unit test (`op-client.test.ts`) fails the build if one is added back. Ingest is a manual, on-demand pull (see the "Ingest" section).

## Obsidian vault

An Obsidian vault is optional (`OBSIDIAN_VAULT_DIR`) and plays two roles: a second ticket intake (manual tickets, alongside OpenProject work packages) and a live mirror of every hub ticket. Postgres and the event store remain the source of truth — the vault never drives state on its own.

- **Layout** (both subfolders configurable — `OBSIDIAN_INBOX_DIR`/`OBSIDIAN_TICKETS_DIR`, default `hub/inbox`/`hub/tickets` — so the vault can follow Tiago Forte's PARA method, e.g. an `Inbox/` area and a `Projects/hub-tickets/` area):
  - `<OBSIDIAN_INBOX_DIR>/*.md` — notes you write by hand. Frontmatter: `title` (required), `repo` (optional hint for triage), `priority` (`low`/`normal`/`high`/`immediate`), `tags` (list). The body becomes the ticket description.
    ```markdown
    ---
    title: Fix the coffee machine
    repo: backend-parkingapp
    priority: low
    tags: [facilities]
    ---
    It leaks from the side when the tank is full.
    ```
  - `<OBSIDIAN_TICKETS_DIR>/<key>.md` — hub-managed mirror, one file per ticket (`OP-<workPackageId>` or the manual `M-0001` key). Frontmatter (key, source, title, state, riskTier, targetRepo, updatedAt, hub URL) is owned by the hub and rewritten on every state-changing event; a marker line (`<!-- hub:notes — everything below is yours -->`) separates it from the body below, which is never touched by the hub. Writes are atomic (temp file + rename) and a mirror failure is logged, never breaks the event append.
- **Import**: `POST /api/ingest/fetch` parses every `*.md` in the inbox. A valid note is moved to `<OBSIDIAN_TICKETS_DIR>/<key>.md` (so it becomes that ticket's mirror, body preserved) and a manual ticket is created, going through the exact same `ticket_received` → triage → planning path as an OpenProject ticket. An invalid note (e.g. missing `title`) is reported in the fetch summary (`obsidian.errors: [{file, message}]`) and left in place, untouched. The note body (and the `repo` hint) is untrusted external text — it flows through the same `wrapUntrusted` path as an OpenProject description and is never placed in a system prompt.
- Path safety: `OBSIDIAN_INBOX_DIR`/`OBSIDIAN_TICKETS_DIR` are validated at startup (relative, no `..`); at import time every note's resolved realpath is checked to stay inside the vault, so a symlink planted inside the vault that points elsewhere is reported as an error rather than followed.
- Terminal-state archiving (moving a finished ticket's mirror note elsewhere in the vault) is not implemented; mirror notes stay in `<OBSIDIAN_TICKETS_DIR>` for every state, including terminal ones.

## Authorship and license

Concept, business model, workflow and architecture by **Esteban Navarro** ([@Macstban](https://github.com/Macstban)). See [AUTHORS.md](AUTHORS.md) and [LICENSE](LICENSE). All rights reserved.
