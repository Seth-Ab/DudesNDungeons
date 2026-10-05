---
name: issue
description: Create DudesNDungeons GitHub issues in the house format. Validates the request against the repository, deduplicates against open and closed issues, applies existing labels, and publishes with gh. Use when asked to file, draft, or publish one or more issues, including candidates handed over by backlog-audit. Do not use for implementing issues.
---

# Issue

Turn a described problem or piece of work into a GitHub issue that matches the repository's
existing issues. Callers such as `backlog-audit` supply the findings; this skill owns the format,
deduplication, labeling, and publishing.

## Authorization

- Drafting is always allowed and is read-only: show the full title, labels, and body.
- Publishing (`gh issue create`) requires explicit user authorization of the named issue or a
  clearly bounded set. A request such as "file an issue for X" or "create these issues" counts;
  a request to audit, review, or propose does not.
- Never close, edit, relabel, or comment on existing issues, and never create or change repository
  labels, without separate authorization.
- Do not begin implementation. Use the `ticket` skill for that, only when separately asked.

## 1. Gather and Validate

Read `AGENTS.md`, the relevant `STEPS.md` section, and `PROGRESS.md`. Read `GAMEDESCRIPTION.md` for
design-adjacent issues, but never edit it or propose edits to it; it is owner-authored.

Inspect the implementation and tests before calling anything confirmed. Distinguish planned
roadmap work from defects in behavior that is already meant to work. Do not invent features beyond
`GAMEDESCRIPTION.md` and `STEPS.md`; route unresolved product choices to an owner-decision issue
instead of deciding them.

## 2. Deduplicate

Before drafting each issue:

```sh
gh issue list --state all --limit 200 --json number,title,state,labels
gh issue list --state all --search "<keywords>" --json number,title,state
```

Check open and closed issues. For close matches, read them with `gh issue view <n>`.

- Open duplicate: do not file; report the existing number.
- Closed and fully done: do not file, unless the problem demonstrably regressed or was only
  partly fixed. Then file a follow-up that links the closed issue, like #62 following #35.
- Related but distinct: file, and cross-reference under Dependencies (`#N`).
- Also check that `PROGRESS.md` does not already record the work as complete.

## 3. Title

Imperative, specific, sentence case, no trailing period, no type prefix. Phases of a series use
`<Series> Phase N: <topic>`. Examples: `Smooth remote player movement with a buffered interpolation
delay`, `Implement server-authoritative traps`, `Decide the progression economy and
duplicate-scroll upgrade path`.

## 4. Body

Use these headings in this order. Omit a heading only where noted.

```markdown
## Classification

<Type>. Confidence: <high|medium|low>[ that ..., medium on ...].

## Roadmap

[<STEPS.md step name>](https://github.com/Seth-Ab/DudesNDungeons/blob/main/STEPS.md#L<start>-L<end>)

## Evidence and impact

- <Finding with a [permalink-style link](https://github.com/Seth-Ab/DudesNDungeons/blob/main/<path>#L<line>)>.
- <Impact on players, correctness, or future work.>

## Scope

<What to change, concretely. For umbrella issues, list owner decisions and likely follow-ups.>

## Acceptance criteria

- [ ] <Observable, testable outcome.>
- [ ] <Required tests, naming the cases.>

## Dependencies

<`#N` links and why, or "None.">

## Out of scope

<Adjacent work that must not be folded in.>
```

Rules:

- **Classification** is one of: `Bug` (add `(follow-up to #N)` when relevant), `Planned work`
  (with a qualifier such as `Planned performance work`), `Test gap`, `Documentation drift`,
  `Owner decision`. State confidence honestly; a medium or low confidence says what is uncertain.
- **Roadmap** links the specific `STEPS.md` section by line range. Verify the line numbers against
  the current file with `grep -n`. Link several sections when the issue spans them.
- **Evidence** cites file paths and line numbers as links to `main` on GitHub, verified against
  the working tree. For bugs, include run or test output where available (command and
  failing result). Reproductions from an owner playtest are stated as such.
- **Owner decisions** replace `Scope` with `## Decision required` (a list of choices to make).
  Acceptance criteria then describe recorded decisions and updates to `STEPS.md` and `PROGRESS.md`.
- **Acceptance criteria** are checkboxes, each independently verifiable, and name the tests
  required per `AGENTS.md` (invalid input, disconnects, server-side validation for server rules).
  Include a verification step with real clients when the behavior is visible or multiplayer.
- Keep one coherent, independently reviewable change per issue. Split larger work, or file an
  umbrella issue with `needs-owner-decision` that lists likely follow-ups.
- Respect `AGENTS.md` boundaries: server-owned state, no client-trusted values, the `#`/`.` map
  alphabet, and the `src/client`, `src/server`, `src/shared` split.

## 5. Labels

Use only labels that already exist (`gh label list`). Pick:

- **One type label**: `bug`, `enhancement`, `documentation`, `accessibility`, or `question` (used
  for owner-decision issues, together with `needs-owner-decision`).
- **One or more area labels**: `area:frontend`, `area:backend`, `area:networking`,
  `area:gameplay`, `area:progression`, `area:voice`, `area:documentation`, `area:tooling`.
  Label every area the change touches.
- **`agent-ready`** only if the issue has no unresolved owner decision and no open blocking
  dependency, and its scope and acceptance criteria are complete enough to implement without
  asking. Never combine it with `needs-owner-decision`.
- **`needs-owner-decision`** when the issue needs owner design input before implementation.
- `good first issue` only for small, self-contained, low-risk changes. Do not use `duplicate`,
  `invalid`, `wontfix`, or `help wanted` when filing.

## 6. Publish

After authorization, write the body to a file in the scratchpad (not the repository) and create the issue:

```sh
gh issue create --title "<title>" --body-file <body.md> --label "<label>" --label "<label>"
```

Create issues one at a time, in dependency order, so later issues can reference earlier numbers
(update the body before creating, not after). If `gh` rejects a label, stop and report; do not
create labels. Never run `gh issue create` while testing or demonstrating this skill; show the
draft instead.

Report each created issue's URL, number, title, and labels, plus any candidates skipped as
duplicates with the issue number that covers them.
