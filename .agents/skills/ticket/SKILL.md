---
name: ticket
description: Complete one approved DudesNDungeons GitHub issue end to end by validating the issue, creating an isolated branch, implementing and verifying its scope, committing, pushing, and opening a pull request. When invoked inside Herdr, hand execution to Claude in a new tab. Use when given a specific issue URL or number. Do not use for backlog audits, unresolved owner decisions, or merging pull requests.
---

# Ticket

Complete one GitHub issue through a review-ready pull request. The issue is the scope boundary. A
`/ticket` invocation with an issue URL or number authorizes repository edits, a dedicated branch,
commits, a push, and PR creation for that issue. It does not authorize merging, closing the issue
before merge, changing repository settings, or implementing separate dependency issues.

## Optional Herdr Handoff

Check this before GitHub queries, branch creation, or other mutations:

1. If the invocation contains the exact handoff marker `TICKET_HERDR_CHILD=1`, or that environment
   variable is exactly `1`, this is the delegated Claude worker. Do not create another tab; continue
   directly with step 1 below. Note any `TICKET_PARENT=<pane-id>` marker for the final handoff.
2. Otherwise, if `HERDR_ENV` is exactly `1`, read
   [references/herdr-delegation.md](references/herdr-delegation.md) and perform that handoff.
3. Otherwise, continue with step 1 in the current agent.

A successful handoff transfers the entire ticket workflow to Claude. The original agent monitors and
reports the delegated run but must not create a competing branch, edit files, or open another PR.

## 1. Validate the Ticket Before Mutating the Repository

Resolve the issue with GitHub and read its title, body, labels, comments, state, dependencies, and
acceptance criteria. Confirm that it belongs to this repository and is open.

Before creating a branch:

- Search open and closed pull requests for the issue number and title. Do not create a duplicate PR.
- Stop without editing code when the issue has `needs-owner-decision`, an unresolved design question,
  or an open dependency required by its acceptance criteria. Report the exact decision or dependency.
- Treat `agent-ready` as a strong readiness signal, but still verify the issue against current code.
- If the requested behavior is already complete, verify it and report the evidence instead of making
  an empty branch or PR.
- If the issue and current repository disagree materially, explain the mismatch and ask for direction
  rather than silently changing the approved scope.

## 2. Protect Existing Work and Create the Branch

Inspect `git status --short`, the current branch, the default branch, and configured remotes. Never
discard, reset, stash, stage, or commit unrelated user work.

Run `npm run worktrees:prune -- --dry-run` and report any worktrees it would remove from earlier
tickets, so they don't silently accumulate. Only remove one (`npm run worktrees:prune`) when the
user asks or when a prior ticket's worktree is confirmed merged and clean.

Fetch the current default branch, then create the issue branch before editing files. Use a concise
name containing the issue number, such as `fix/issue-28-websocket-payload-limit`,
`feature/issue-31-boss-gating`, or `chore/issue-36-progress-sync`.

When the current worktree has unrelated tracked changes, prefer a separate git worktree based on the
updated default branch. If a safe isolated branch or worktree cannot be created, stop and report the
conflict. Never force-push or reuse an unrelated branch. If the intended branch already exists,
inspect it before deciding whether it is safe to resume.

## 3. Re-establish Repository Context

On the issue branch, read:

- `AGENTS.md` for repository rules;
- the issue-linked section of `STEPS.md`;
- `PROGRESS.md` for current implementation state and blockers;
- `GAMEDESCRIPTION.md` for design-adjacent work, without editing or proposing edits to it;
- the implementation and tests cited by the issue.

Use `project-progress-sync` for every ticket. Also use the matching repo skills when the work touches
backend authoritative state, frontend gameplay, or the shared protocol. Do not use `backlog-audit`
to implement the issue.

Turn every acceptance criterion into an implementation and verification checklist. Keep separately
linked issues out of scope unless the user explicitly authorizes completing them too.

## 4. Implement the Approved Scope

Implement the smallest coherent change that satisfies every acceptance criterion and repository
invariant. Include all work inherently required by the ticket, such as shared types, server and
client consumers, migration-safe content changes, tests, and durable documentation.

- Preserve server authority and validate every client-controlled input.
- Keep protocol schemas, senders, consumers, tests, and versioning aligned.
- Add or update deterministic tests for meaningful behavior, invalid input, lifecycle edges, and
  regressions identified by the issue.
- Update `PROGRESS.md` when a roadmap step or substep is completed, changed, blocked, skipped, or
  materially re-scoped.
- Update other durable docs when commands, configuration, architecture, or contributor workflow
  changes.
- Do not edit `GAMEDESCRIPTION.md`.
- Do not fold opportunistic refactors, dependency upgrades, or neighboring tickets into the branch.

For visible gameplay changes, inspect the result in a browser when practical and capture the
screenshot or recording expected by the PR template. If visual verification is unavailable, say so
truthfully in the PR.

## 5. Verify Before Committing

Run focused tests while developing, then run every repository check required by `AGENTS.md` and any
applicable skill. For a normal completed ticket, the final gate is:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Also run `npm run build:sprites` after art-source changes and verify the baked PNG is included. Do
not weaken, skip, or delete tests to obtain a pass. Diagnose failures and distinguish regressions
from independently reproducible infrastructure or pre-existing failures.

Before committing, inspect `git diff`, run `git diff --check`, and check `git status --short`. Confirm
that every changed file belongs to the ticket and that secrets, generated local data, and unrelated
untracked files are absent.

## 6. Commit and Push

Stage only the intended paths and review the staged diff. Use an imperative commit subject consistent
with `AGENTS.md`, normally no more than 72 characters. Prefer one coherent commit; use multiple only
when they make review or rollback materially clearer.

Push the issue branch with its upstream set. Never force-push unless the user separately authorizes
it after the exact reason is explained.

## 7. Open and Validate the Pull Request

Read `.github/pull_request_template.md` and open a PR against the repository's default branch. The PR
must include:

- a concise summary of the behavior changed;
- the exact verification commands and results;
- screenshots or recordings for visible changes, or an explicit reason they are absent;
- backend/frontend contract, networking, persistence, and security notes when relevant;
- `Closes #<issue-number>` so GitHub closes the issue only after merge;
- remaining limitations or intentionally out-of-scope work.

Read the created PR back to verify its base, head, body, issue link, and URL. Watch required checks.
If a check fails because of the change, fix it on the same branch, rerun the relevant local checks,
commit, push, and re-check CI. Stop and report when a failure requires owner input, new authority, or
an external service change. Do not merge the PR.

## 8. Handoff

Report the issue URL, branch, commit hash or hashes, PR URL, checks run, CI state, and any reviewer
notes. State whether the working tree is clean and identify any untouched pre-existing changes.

If this run used a separate worktree, do not remove it yet, since the PR is not merged. Tell the
user it will show up in `npm run worktrees:prune --dry-run` once the PR merges.

## Report Completion to the Coordinator

Only when the invocation carried `TICKET_PARENT=<pane-id>`, and only after the PR is open, required
checks are green, and the working tree is clean and pushed, send the coordinator one line:

```bash
herdr agent prompt <pane-id> "ticket_<n> complete: <PR url>, CI green. Verify, then follow the Herdr delegation closing rule."
```

Send it once, without `--wait`. Do not close your own tab or agent, do not remove the worktree, and
do not delete the branch. The coordinator verifies the claim and decides whether to close the tab
(only when `TICKET_AUTOCLOSE=1` was given). Cleanup of the worktree and branch happens after the PR
merges, via `npm run worktrees:prune`, or on the user's request. If checks are failing or pending,
or you are stopping for owner input, do not send the message; report in this tab instead.
