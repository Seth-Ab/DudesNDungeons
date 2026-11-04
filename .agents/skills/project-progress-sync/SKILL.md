---
name: project-progress-sync
description: Use when work starts or ends in this repository and the agent needs to find the current project state or update progress tracking.
---

# Project Progress Sync

Use this skill for DudesNDungeons work that depends on knowing what happened last, what should happen next, or what project files must be kept in sync.

## Sources

Read these first when starting a new task or resuming after a context break:

- `AGENTS.md` for contributor and agent rules.
- `STEPS.md` for the planned frontend/backend roadmap.
- `PROGRESS.md` for the current phase, completed items, blockers, and next recommended step.

Use `README.md` only when commands or setup details are needed.

## Updating Progress

Update `PROGRESS.md` whenever a step or substep is completed, changed, blocked, skipped, or materially re-scoped. Keep the update short and concrete:

- Add one `Activity Log` bullet for the date of the work: the change, the issue number, and the protocol version when it changed. Put it at the top of the list; the log is newest first and is the only record of history.
- Leave `Current Status` alone unless the restart point, blocker, or phase really changes. Never copy a ticket summary or the protocol version (`PROTOCOL_VERSION` is the source of truth) into it; that is the line parallel pull requests conflict on.
- Check off matching roadmap items only when they are actually complete.
- Keep every `PROGRESS.md` line under about 400 characters; wrap longer text onto indented continuation lines.
- Record blockers with the exact condition and what would unblock them.

Do not mark a roadmap item complete just because scaffolding exists. For example, a WebSocket client stub is not the same as real backend snapshot integration.

## Documentation Sync

When commands, structure, protocols, or workflows change, update the relevant durable docs in the same change:

- `README.md` for user-facing setup and command changes.
- `AGENTS.md` for contributor or agent behavior changes.
- `STEPS.md` only when the roadmap itself changes.
- PR body or comments for reviewer-facing context.

Before finishing, check `git status --short` and mention whether changes are committed, pushed, or local only.
