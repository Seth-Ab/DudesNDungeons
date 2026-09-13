# Repository Guidelines

## Sources of Truth

Use `AGENTS.md` for contributor and agent instructions. Use `STEPS.md` as the project roadmap, including frontend/backend work groups and opinion checkpoints that need owner input. Use `PROGRESS.md` as the working ledger; update it whenever a step or substep is completed, changed, blocked, or skipped, and check it before starting new work.

## Project Structure & Module Organization

This repository is currently at planning/scaffold stage. Keep new source code organized by responsibility:

- `src/client/` for browser UI, input, rendering, local state, networking, and WebRTC audio.
- `src/server/` for authoritative dungeon state, sessions, WebSocket networking, and voice signaling.
- `src/shared/` for protocol messages, shared game utilities, constants, and TypeScript types.
- `content/` for editable game data such as dungeons, items, monsters, and player skills.
- `assets/` for sprites, maps, audio, and UI media.
- `tests/` for automated coverage split into `client`, `server`, `shared`, and `e2e`.
- `docs/` for architecture notes and decision records.
- `scripts/` for local automation and one-off project scripts.
- `config/` for checked-in, non-secret configuration templates.

Avoid mixing client-only browser code with server logic. Shared protocol definitions should live in one place so clients and the server cannot drift.

## Build, Test, and Development Commands

Tooling uses Node.js, TypeScript, Vite for the browser client, and Vitest/ESLint for backend and shared code.

- `npm install` installs dependencies.
- `npm run dev:client` starts the frontend dev server.
- `npm run dev:server` starts the backend server with reload.
- `npm run build` compiles the server and builds the frontend.
- `npm run typecheck` runs TypeScript checks without emitting files.
- `npm run lint` runs ESLint.
- `npm test` runs the Vitest suite.

GitHub Actions runs `npm ci`, `npm test`, and `npm run build` for pull requests to `main`. Keep these checks passing before requesting review or merge.

Do not introduce new commands without adding them to project documentation.

## Coding Style & Naming Conventions

Prefer TypeScript for new game, networking, and protocol code. Use 2-space indentation, semicolons, and descriptive names. Use `camelCase` for variables and functions, `PascalCase` for classes/components/types, and `SCREAMING_SNAKE_CASE` for constants.

Name protocol messages by intent, such as `playerMove`, `attackResolved`, or `voiceRangeUpdated`. Keep server validation explicit and avoid trusting client-sent positions, health, loot, or combat results.

## Testing Guidelines

Add tests alongside meaningful behavior, especially server-side game rules and message validation. Use filenames like `movement.test.ts`, `combat.test.ts`, or `sessions.test.ts`. Prioritize deterministic tests for dungeon state transitions before testing rendering details.

For multiplayer features, include tests for invalid input, disconnected players, duplicate session joins, and proximity distance calculations.

## Commit & Pull Request Guidelines

The current Git history only shows an initial commit (`First`), so no detailed convention exists yet. Use short, imperative commit messages such as `Add session manager` or `Validate movement bounds`.

Use `.github/pull_request_template.md` for every pull request. Keep reports concise and reviewer-friendly: summarize the change, list test results, include screenshots or recordings for visible gameplay changes, and call out backend/frontend contract changes, networking assumptions, or security-sensitive areas.

## Security & Configuration Tips

Keep secrets, API keys, and local certificates out of the repository. Document required variables with safe example values.
