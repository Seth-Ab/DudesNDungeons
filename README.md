# DudesNDungeons

A browser-first co-op dungeon crawler prototype with authoritative multiplayer state and proximity voice chat.

## Design Decisions

Resolved in `STEPS.md` and recorded in `PROGRESS.md`:

- Visual style: pixel art.
- Movement: slow free-roam with continuous server-side collision.
- Combat: hybrid, real-time positioning with a turn-like action exchange.
- Voice: always connected, volume attenuated by in-game distance.
- Party size for v1: 4.

Runtime and renderer choices are recorded in `docs/decisions/0001-runtime-and-tooling.md`.

## Requirements

- Node.js 20.11 or newer.

## Getting Started

```bash
npm install
cp config/.env.example .env   # optional; defaults work as-is
npm run dev
```

The server listens on `http://localhost:8080` with a `/health` endpoint and a WebSocket endpoint on
the same port.

## Commands

- `npm run dev` - run the server with reload on change.
- `npm run build` - compile the server and shared code to `dist/`.
- `npm start` - run the compiled server from `dist/`.
- `npm test` - run the test suite once.
- `npm run test:watch` - run tests in watch mode.
- `npm run lint` - lint the project.
- `npm run typecheck` - type-check without emitting.

The client dev and build commands arrive with Frontend Dev step 1.

## Project Layout

- `src/client/` - browser UI, rendering, input, local state, network client, and WebRTC audio.
- `src/server/` - authoritative dungeon state, sessions, WebSocket networking, and voice signaling.
- `src/shared/` - protocol definitions, shared game helpers, constants, and TypeScript types.
- `content/` - editable game data for dungeons, items, monsters, and skills.
- `assets/` - sprites, maps, audio, and UI media.
- `tests/` - client, server, shared, and end-to-end tests.
- `docs/` - architecture notes and decision records.
- `scripts/` - local automation scripts.
- `config/` - non-secret configuration templates.

See `AGENTS.md` for contributor guidance, `STEPS.md` for the roadmap, and `PROGRESS.md` for the current project checkpoint.
