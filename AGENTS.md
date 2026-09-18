# Repository Guidelines

## Sources of Truth

Use `AGENTS.md` for contributor and agent instructions. Use `STEPS.md` as the project roadmap, including frontend/backend work groups and opinion checkpoints that need owner input. Use `PROGRESS.md` as the working ledger; update it whenever a step or substep is completed, changed, blocked, or skipped, and check it before starting new work.

Use `GAMEDESCRIPTION.md` as the source of truth for overall game direction (vision, pillars, level design, movement, gameplay). It is owner-authored only: read it before design-adjacent work, but agents must never write or propose edits to it.

Repo-local shared skills live in `agent-skills/`. Use them when their descriptions match the task, especially for progress syncing, protocol changes, frontend gameplay slices, and backend authoritative state work. These skills are tool-agnostic guidance for Codex, Claude, and human contributors.

## Project Structure & Module Organization

This repository is currently at planning/scaffold stage. Keep new source code organized by responsibility:

- `src/client/` for browser UI, input, rendering, local state, networking, and WebRTC audio.
- `src/server/` for authoritative dungeon state, sessions, WebSocket networking, and voice signaling.
- `src/shared/` for protocol messages, shared game utilities, constants, and TypeScript types.
- `content/` for editable game data such as dungeons, items, monsters, and player skills.
- `assets/` for sprites, maps, audio, and UI media. Pixel art is authored as text under `assets/sprites/source/` and baked to a PNG; see `assets/sprites/README.md`.
- `tests/` for automated coverage split into `client`, `server`, `shared`, and `e2e`.
- `docs/` for architecture notes and decision records.
- `scripts/` for local automation and one-off project scripts.
- `config/` for checked-in, non-secret configuration templates.
- `agent-skills/` for repo-local shared skills used by AI agents and contributors.

Avoid mixing client-only browser code with server logic. Shared protocol definitions should live in one place so clients and the server cannot drift.

## World State & Rendering Boundary

The server owns whether a party is in the hub or a dungeon, unanimous-ready checks, run generation,
escape/wipe outcomes, torch ownership, and banked items. Clients send interaction intent and render
the authoritative snapshot; they must not locally advance the run lifecycle.

Authored maps currently use only `#` and `.`. Adding a tile character is a coordinated content,
collision, protocol, and renderer change. Backend lifecycle work should keep that alphabet and avoid
`src/client/rendering/` and `assets/`, so renderer and pixel-art work can proceed independently.

## Build, Test, and Development Commands

Tooling uses Node.js, TypeScript, Vite for the browser client, and Vitest/ESLint for backend and shared code.

- `npm install` installs dependencies.
- `npm run dev:client` starts the frontend dev server.
- `npm run dev:server` starts the backend server with reload.
- `npm run build` compiles the server and builds the frontend.
- `npm run build:sprites` bakes `assets/sprites/source/` into the tilesheet the client draws with. Run it after editing the art and commit the PNG alongside the source; a test fails if they drift.
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

Git history now favors short, imperative subject lines such as `Add session and player management`, `Fix movement pacing, spawn stacking, and client prediction`, and `Implement authoritative dungeon state`. Keep that style as the project convention:

- Start with an imperative verb such as `Add`, `Fix`, `Implement`, `Document`, `Update`, `Align`, or `Verify`.
- Describe the changed behavior or artifact in plain language; avoid vague subjects such as `Changes`, `Updates`, or `WIP`.
- Keep the subject line concise, generally 72 characters or fewer, with no trailing period.
- Use an optional body when context, tradeoffs, protocol changes, or follow-up work would help reviewers.
- Let GitHub generate merge commit subjects for pull requests, such as `Merge pull request #7 from contributor/feature-client-networking`.
- Use `Revert "<original subject>"` when reverting a prior change.

Use `.github/pull_request_template.md` for every pull request. Keep reports concise and reviewer-friendly: summarize the change, list test results, include screenshots or recordings for visible gameplay changes, and call out backend/frontend contract changes, networking assumptions, or security-sensitive areas.

## Security & Configuration Tips

Keep secrets, API keys, and local certificates out of the repository. Document required variables with safe example values.
