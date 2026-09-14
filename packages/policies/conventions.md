# Conventions

> DRAFT — to be validated with the team (Phase 0). Seeded from `AGENT.md`.

## All stacks

- Code, identifiers and comments in English. Team conversation may be in Spanish.
- Conventional commits (`feat:`, `fix:`, `chore:`, ...).
- Tests live next to the feature they cover and ship in the same change.
- Contracts first: define version, method, path, payloads and error codes before implementing.

## Rails (`backend-parkingapp`)

- API-only; self-service endpoints under `namespace :self_service`, new endpoints versioned (`/v2`).
- Reuse the existing auth filters; return clear JSON with `{ message }` on 4xx/5xx.
- Request/controller specs with RSpec (`bundle exec rspec`).
- Branch name `{wpId}-{slug}`.

## FastAPI (`libredte-api`)

- Tests with `pytest`; keep routers thin and business logic in services.
- Branch name `feat/{slug}`.

## Flutter (`autoatencion-flutter`, later phase)

- Riverpod for state; API access only through `lib/data_manager/api_client.dart`; models in `lib/models`.
