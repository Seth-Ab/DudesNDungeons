# DudesNDungeons

A browser-first co-op dungeon crawler prototype with authoritative multiplayer state and proximity voice chat.

## Design Decisions

Resolved in `STEPS.md` and recorded in `PROGRESS.md`:

- Visual style: pixel art.
- Movement: slow free-roam with continuous server-side collision.
- Combat: hybrid, real-time positioning with a turn-like action exchange.
- Voice: always connected, volume attenuated by in-game distance.
- Party size for v1: 4.

Runtime and renderer choices are recorded in `docs/decisions/0001-runtime-and-tooling.md`. Session,
disconnect, and reconnect behavior is recorded in `docs/decisions/0002-session-lifecycle.md`.
Server-owned movement and dungeon state are in `docs/decisions/0003-authoritative-dungeon-state.md`,
and combat, monsters, and items are in `docs/decisions/0004-combat-and-items.md`.

## Requirements

- Node.js 20.19 or newer.

## Getting Started

```bash
npm install
cp config/.env.example .env   # optional; defaults work as-is
npm run dev:server
```

The server listens on `http://localhost:8080` and serves both HTTP and WebSocket traffic on that
port.

## Server API

- `GET /health` - liveness, protocol version, and the number of live sessions.
- `POST /sessions` - create a dungeon. Returns `{ sessionId, roomCode }`; share the room code with
  the party.
- `ws://localhost:8080` - gameplay. Connect, then send `joinSession` with the room code.

A dungeon must exist before anyone can join it, so the flow is: one player calls `POST /sessions`,
then everyone connects over WebSocket and sends `joinSession` with the returned room code.

`sessionJoined` returns a `resumeToken`. Keep it for the life of the tab and send it back in a later
`joinSession` to reclaim the same player slot after a refresh or a dropped connection; a slot is
held for 60 seconds. The token is a credential, so it is only ever sent to its owner and must not be
logged or shared.

## Commands

- `npm run dev` - start the frontend dev server.
- `npm run dev:client` - start the frontend dev server.
- `npm run dev:server` - run the server with reload on change.
- `npm run build` - compile the server and build the frontend.
- `npm run build:server` - compile server and shared code to `dist/`.
- `npm run build:client` - typecheck the client and build it to `dist/client/`.
- `npm start` - run the compiled server from `dist/`.
- `npm test` - run the test suite once.
- `npm run test:watch` - run tests in watch mode.
- `npm run lint` - lint the project.
- `npm run typecheck` - type-check server, shared, tests, and client code without emitting.

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
- `agent-skills/` - repo-local shared skills for repeated AI-agent and contributor workflows.

## Frontend Development

The frontend currently uses Vite, TypeScript, and a vanilla Canvas renderer.

- `npm install` - install dependencies.
- `npm run dev:client` - start the frontend dev server.
- `npm run build:client` - typecheck and build the frontend.
- `npm run typecheck:client` - run frontend TypeScript checks only.

Run `npm run dev:server` and `npm run dev:client` together: the client is served from port 5173 and
talks to the backend on port 8080.

Set `VITE_WS_URL` to point the client at a different backend, for example
`VITE_WS_URL=ws://192.168.1.20:8080`. It defaults to `ws://localhost:8080`, and the HTTP origin for
`POST /sessions` is derived from it, so the two can never disagree.

Because the dev client and the API are on different ports, the server sends
`Access-Control-Allow-Origin` on its HTTP routes. It allows any origin by default; set `CORS_ORIGIN`
to restrict it. WebSocket connections are not subject to CORS and need no such setting.

## Pull Request Checks

GitHub Actions runs CI on pull requests to `main`. The workflow installs dependencies with `npm ci`, runs `npm test`, and builds the server and frontend with `npm run build`.

See `AGENTS.md` for contributor guidance, `STEPS.md` for the roadmap, `PROGRESS.md` for the current project checkpoint, and `GAMEDESCRIPTION.md` for the owner-authored game vision (read-only for agents).
