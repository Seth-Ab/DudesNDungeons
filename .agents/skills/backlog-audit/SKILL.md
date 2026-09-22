---
name: backlog-audit
description: Audit DudesNDungeons roadmap, progress, code, and tests for actionable bugs or incomplete work, and prepare or publish deduplicated GitHub issue candidates. Do not use for implementing issues.
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
- Existing open and closed GitHub Issues, when available, for duplicate detection.

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

Do not invent features beyond `GAMEDESCRIPTION.md` and `STEPS.md`. Route unresolved product choices
to `needs-owner-decision` rather than silently deciding them.

Run the repository checks relevant to the audit. A full audit should normally run `npm test`,
`npm run typecheck`, `npm run lint`, and `npm run build`. Report failures as evidence; do not weaken
or edit tests during an audit-only run.

## Default: Proposal-Only Audit

Unless the user explicitly authorizes issue creation, keep the run read-only:

- Do not edit files or implement fixes.
- Do not create, close, label, or modify GitHub Issues.
- Return no more than 15 high-value candidates, ordered by impact and dependency.
- Exclude duplicates and work already recorded as complete.

For each candidate, provide:

- title and classification (`bug`, `planned-work`, `test-gap`, `documentation-drift`, or
  `owner-decision`);
- suggested existing labels;
- evidence with file paths and line numbers;
- impact and proposed scope;
- acceptance criteria and required tests;
- dependencies and explicit out-of-scope notes;
- confidence (`high`, `medium`, or `low`).

## Publishing Issues

Create GitHub Issues only when the user explicitly authorizes publication of named candidates or a
clearly bounded approved set. Before each creation:

1. Search open and closed issues for duplicates.
2. Preserve the approved scope and acceptance criteria.
3. Use existing labels; do not create or change repository labels without separate authorization.
4. Apply `agent-ready` only when the issue has no unresolved owner decision or dependency.
5. Link the relevant `STEPS.md` section and cite repository evidence.

Report the created issue URLs. Do not begin implementation as part of issue publication unless the
user separately asks for it.
