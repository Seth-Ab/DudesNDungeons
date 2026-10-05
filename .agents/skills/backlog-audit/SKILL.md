---
name: backlog-audit
description: Audit DudesNDungeons roadmap, progress, code, and tests for actionable bugs or incomplete work, and hand issue candidates to the issue skill for drafting and publishing. Do not use for implementing issues.
---

# Backlog Audit

Use this skill when reviewing the repository for incomplete, broken, stale, or insufficiently
tested work that may belong in GitHub Issues.

## Sources of Truth

Read before drawing conclusions:

- `AGENTS.md` for repository rules and authority boundaries.
- `GAMEDESCRIPTION.md` for owner-authored game direction. Never edit or propose edits to it.
- `STEPS.md` for the roadmap.
- `PROGRESS.md` for completed, partial, blocked, and recommended work.

Inspect the relevant implementation and tests before calling a finding confirmed. Distinguish
planned roadmap work from defects in behavior that is already meant to work.

## Audit Scope

Look for:

- incomplete or partial work recorded in `PROGRESS.md`;
- roadmap requirements whose implementation is missing or inconsistent;
- `TODO`, `FIXME`, placeholder, stub, or `notImplemented` paths;
- failing, skipped, flaky, or materially missing tests;
- contradictions between documentation, tests, and implementation;
- concrete validation, security, lifecycle, or multiplayer edge-case defects.

Do not invent features beyond `GAMEDESCRIPTION.md` and `STEPS.md`. Flag unresolved product choices
as owner decisions rather than silently deciding them.

Run the repository checks relevant to the audit. A full audit should normally run `npm test`,
`npm run typecheck`, `npm run lint`, and `npm run build`. Report failures as evidence; do not weaken
or edit tests during an audit-only run.

## Candidates and Publishing

Unless the user explicitly authorizes issue creation, keep the run read-only: do not edit files,
implement fixes, or create, close, label, or modify GitHub Issues. Return no more than 15
high-value candidates, ordered by impact and dependency, and exclude work already recorded as
complete.

Use the `issue` skill to draft every candidate and, when the user authorizes named candidates or a
clearly bounded approved set, to publish them. It owns the issue format, classification,
deduplication against open and closed issues, labeling, and `gh` publishing. Hand it the audit's
findings: evidence with file paths and line numbers, impact, proposed scope, acceptance criteria,
dependencies, out-of-scope notes, and confidence. Audit classifications map to its types:
`bug` to Bug, `planned-work` to Planned work, `test-gap` to Test gap, `documentation-drift` to
Documentation drift, and `owner-decision` to Owner decision.

Do not begin implementation as part of auditing or publication unless the user separately asks.
