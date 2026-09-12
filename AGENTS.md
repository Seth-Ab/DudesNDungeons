# Repository Guidelines

## Sources of Truth

Use `AGENTS.md` for contributor and agent instructions. Use `STEPS.md` as the project roadmap, including frontend/backend work groups and opinion checkpoints that need owner input. Use `PROGRESS.md` as the working ledger; update it whenever a step or substep is completed, changed, blocked, or skipped, and check it before starting new work.

## Project Structure & Module Organization

This repository is currently at planning/scaffold stage. Keep new source code organized by responsibility as the project grows:

- `src/client/` for browser UI, rendering, input, and WebRTC audio handling.
- `src/server/` for authoritative dungeon state, WebSocket signaling, sessions, and game rules.
- `src/shared/` for message types, constants, map utilities, and code used by both client and server.
- `assets/` for sprites, audio, maps, and other game content.
- `tests/` for automated tests that mirror the source layout.

Avoid mixing client-only browser code with server logic. Shared protocol definitions should live in one place so clients and the server cannot drift.

## Build, Test, and Development Commands

No package manager or build scripts are committed yet. Once tooling is added, document the exact commands in `README.md`, `STEPS.md`, and `PROGRESS.md` as appropriate. Expected examples for a Node/browser prototype:

- `npm install` installs dependencies.
- `npm run dev` starts the local client and server development workflow.
- `npm test` runs automated tests.
- `npm run lint` checks formatting and static quality.

Do not introduce new commands without adding them to project documentation.

## Coding Style & Naming Conventions

Prefer TypeScript for new game, networking, and protocol code. Use 2-space indentation, semicolons, and descriptive names. Use `camelCase` for variables and functions, `PascalCase` for classes/components/types, and `SCREAMING_SNAKE_CASE` for constants.

Name protocol messages by intent, such as `playerMove`, `attackResolved`, or `voiceRangeUpdated`. Keep server validation explicit and avoid trusting client-sent positions, health, loot, or combat results.

## Testing Guidelines

Add tests alongside meaningful behavior, especially server-side game rules and message validation. Use filenames like `movement.test.ts`, `combat.test.ts`, or `sessions.test.ts`. Prioritize deterministic tests for dungeon state transitions before testing rendering details.

For multiplayer features, include tests for invalid input, disconnected players, duplicate session joins, and proximity distance calculations.

## Commit & Pull Request Guidelines

The current Git history only shows an initial commit (`First`), so no detailed convention exists yet. Use short, imperative commit messages such as `Add session manager` or `Validate movement bounds`.

Pull requests should include a concise summary, test results, and screenshots or short recordings for visible gameplay changes. Link related issues and call out networking or security-sensitive changes.

## Security & Configuration Tips

Keep secrets, API keys, and local certificates out of the repository. Document required variables with safe example values.
