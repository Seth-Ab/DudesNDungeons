---
name: next-issue
description: Pick the next DudesNDungeons GitHub issue to work on that is unlikely to conflict with work already in flight, then start it with the ticket skill. Detects in-progress work from Herdr agents, open pull requests, and issues the user mentions. Use when asked for the next issue, or to start another ticket in parallel. Do not use when a specific issue is already named; use ticket for that.
---

# Next Issue

Choose one open issue that can be implemented in parallel with everything already being worked on,
then hand it to `ticket`. The goal is to avoid merge conflicts and duplicated effort, not to rank
the whole backlog.

Invoking this skill authorizes selecting an issue and invoking `ticket` for it, which carries
`ticket`'s own authority (branch, commits, push, PR). It does not authorize anything beyond that
single issue.

## 1. Collect Work Already in Flight

Build one list of in-progress issues from every source below. Union them; a missing source is not
an error.

1. **Mentioned by the user.** Any issue numbers, URLs, branches, or PRs named in the invocation are
   in flight, even if GitHub does not show them (for example work in another checkout or machine).
2. **Herdr.** If `HERDR_ENV` is exactly `1`, run `herdr agent list` and `herdr tab list`. Keep
   agents whose `cwd` is this repository. Map each to an issue number using the agent name
   (`ticket_<n>`), tab label (`ticket-<n>`), or `herdr agent read <name> --source recent-unwrapped`
   for an issue URL or branch name. Treat `working` and `blocked` agents as in flight; an `idle`
   agent counts too if its branch has an unmerged PR or unpushed commits. Never send input to, focus,
   or close any agent or tab. Do not run bare `herdr`.
3. **Git and GitHub.** Run `git worktree list`, `git branch --list '*issue-*'`, and
   `gh pr list --state open --json number,title,headRefName,files,body`. Branches and PRs naming
   `issue-<n>` or containing `Closes #<n>` are in flight. Also list `needs-owner-decision` and
   recently closed PRs only to avoid reselecting finished work.

Print the in-flight list with its source before continuing.

Inside Herdr, run the capacity check from the `ticket` skill's
[Herdr delegation](../ticket/references/herdr-delegation.md) (step 2) now. If it stops, report it
and do not select an issue: there is no room to start one.

## 2. Estimate Each In-Flight Item's Footprint

For each in-flight issue, produce a set of likely-touched paths and areas:

- Actual changes win: for a branch or PR, use `git diff --name-only origin/main...<branch>` or the
  PR's `files`.
- Otherwise infer from the issue body: cited files, `area:*` labels, protocol or schema mentions,
  and the cited `STEPS.md` section.
- Always add the shared hot files an issue is likely to touch: `PROGRESS.md`, `STEPS.md`, shared
  protocol types and schemas, `src/client/ui/hud.ts` and similar aggregation points, and test
  helpers. Note these separately because nearly every ticket edits `PROGRESS.md`; treat that as a
  low-weight overlap, not a conflict by itself.

## 3. List and Filter Candidates

Run `gh issue list --state open --limit 100 --json number,title,labels,body,assignees`.

Exclude:

- the in-flight issues from step 1, and any with an open or merged PR;
- issues labeled `needs-owner-decision`, or with an unresolved design question;
- issues with an open dependency required by their acceptance criteria (read `Dependencies`);
- issues assigned to someone else.

Prefer issues labeled `agent-ready`. Consider unlabeled issues only when no `agent-ready` candidate
is safe, and say so.

## 4. Score Collision Risk

For each remaining candidate, estimate its footprint the same way as step 2 and compare it to the
union of in-flight footprints:

- **Conflict:** shares a source file or test file, the same protocol message or schema, or the same
  UI module (for example both edit `controlsMenu.ts`). Reject.
- **Coupled:** depends on behavior another in-flight issue is introducing, or the issue itself
  warns of coordination with one. Reject.
- **Low overlap:** shares only the hot docs (`PROGRESS.md`, `STEPS.md`) or the same broad area in
  different files. Acceptable.
- **Disjoint:** different area and files. Best.

Verify against current code (`rg` for cited symbols) instead of trusting the issue text alone. When
the footprint of a candidate is unclear, read the code it cites before deciding.

Choose the best candidate by, in order: disjoint over low overlap, `agent-ready`, smaller scope,
lower issue number. Pick exactly one.

## 5. Report, Then Start the Ticket

State briefly before acting:

- the in-flight items and their estimated footprints;
- the chosen issue, why it should not collide, and the one or two nearest rejected candidates with
  the reason;
- any low-weight overlap the PR will have to rebase around.

If no candidate is safe, stop and report why instead of picking the least bad one, and offer the
shortest-wait option (for example "safe after #51 merges").

Otherwise invoke the `ticket` skill with the chosen issue number. Pass along any user constraints
from the invocation. Do not implement the issue in this skill, and do not choose a second issue.
Inside Herdr, `ticket` performs its own tab handoff; do not create the tab here.
