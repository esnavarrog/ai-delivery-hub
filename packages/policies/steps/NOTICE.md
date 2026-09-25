# Notice

The step policy documents in this directory (`triage.md`, `planning.md`, `implement.md`,
`review.md`, `qa.md`, `release.md`) are adapted, in our own words, from the pipeline-step
ideas in [Gentle AI](https://github.com/Gentleman-Programming/gentle-ai) (skills
`sdd-explore`, `sdd-propose`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-apply`,
`sdd-verify`, `work-unit-commits`, `chained-pr`, `judgment-day`, and the `review-risk`,
`review-resilience`, `review-readability`, `review-reliability` and `review-refuter`
review agents), MIT-licensed:

```
MIT License

Copyright (c) 2025 Gentleman Programming
```

These documents are not copies of the upstream skills. They restate the underlying ideas
(what each pipeline step is for, what it consumes, what "done" means, and what to avoid) for
a headless, single-tenant server pipeline with no interactive orchestrator, no persistent
memory store, no consent prompts, and no CLI. Everything specific to that interactive
harness (memory tools, delegation protocols, consent envelopes, review receipts, CLI
commands, spec-store conventions, model-assignment tables) has been stripped; only the
step-level intent, inputs, output contract and rules were kept and rewritten for this
project's own schemas (`TriageResult`, `Plan`) and pipeline (`triage` → `planning` →
`implement` → `review` → `qa` → `release`).

See the upstream repository's `LICENSE` file for the full MIT license text.
