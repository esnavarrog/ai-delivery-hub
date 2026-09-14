# Authorship

## Original author

**Esteban Navarro** (GitHub: [@Macstban](https://github.com/Macstban))
Contact: esteban.navarro@redcomercio.cl

Esteban Navarro is the original author of this project and holds intellectual authorship of:

- **The idea and concept**: a central hub where development requests filed in OpenProject are picked up by an AI that triages, plans and (in later phases) implements them, while humans *approve and follow* instead of *doing*.
- **The business model**: centralising every internal development request of a company in one queue, letting competent non-developer staff file requests, and having IT profiles approve, annotate and release AI-produced work through explicit gates.
- **The workflow design**: request → AI triage → versioned AI plan → developer approval → sandboxed implementation → AI and human code review → QA in sandbox → staging → release, with a Jira-like history bound to repository and branch kept locally on the server.
- **The product principles**: one decision per screen, the event timeline as the single source of truth, ticket text treated as untrusted input, humans owning gates and budgets, company policies versioned as code.
- **The architecture**: hexagonal domain with an explicit ticket state machine and append-only event log, a Node server that orchestrates AI runs with budgets, a Vite + React approval interface, and versioned policy files injected into every AI run.
- **The role model**: requester, developer owner, lead, QA and admin, with guards enforced in the domain.
- **The design-draft extension**: AI-produced HTML mockups presented alongside the plan for visual requests.

Conceived and specified on 2026-09-14. The initial implementation was produced under Esteban Navarro's direction and review using AI-assisted development tooling; the direction, decisions and acceptance of every part remain his.

## Contributors

Add yourself below when you contribute code, documentation or design.

| Name | GitHub | Role |
|------|--------|------|
| Esteban Navarro | @Macstban | Original author, concept, architecture, product |
