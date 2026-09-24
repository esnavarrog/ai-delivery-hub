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
- [ ] T1 — Web UI copy in Spanish (route: delegated, writer trigger: many non-trivial files)
- [ ] T2 — AI output language es via policies (route: delegated)
- [ ] T3 — Mirror note Spanish text + README (route: delegated)

## Acceptance criteria
- No English user-visible string remains in the web app (spot-check every route).
- A triage/plan generated with the smoke script returns Spanish prose with unchanged JSON keys.
- Existing Obsidian mirror notes are still updated correctly.

## Progress / Evidence
- Branch `feat/spanish-ui` created from `feat/op-readonly-obsidian` (26a3bca).

## Next step
Delegate T1–T3 to one writer.
