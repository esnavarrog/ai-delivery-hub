# Pillars

> DRAFT — to be validated with the team (Phase 0). Seeded from `AGENT.md`.

1. **Backend before app.** A feature lands in the API first; clients consume it afterwards following the agreed contract.
2. **One repository, one responsibility.** Never mix code between repositories; each repo owns its stack and boundaries.
3. **Respect the existing style.** Follow how the codebase already does things before introducing a new pattern.
4. **Clean architecture.** Domain logic stays independent from frameworks, transport and persistence.
5. **Humans decide.** AI proposes triage and plans; a human owner approves, rejects or requests changes.
6. **Small, reviewable steps.** Prefer several bounded changes over one large one.
