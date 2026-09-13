# DudesNDungeons

A browser-first co-op dungeon crawler prototype with authoritative multiplayer state and proximity voice chat.

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

## Frontend Development

The frontend currently uses Vite, TypeScript, and a vanilla Canvas renderer.

- `npm install` - install dependencies.
- `npm run dev` - start the frontend dev server.
- `npm run build` - typecheck and build the frontend.
- `npm run typecheck` - run TypeScript checks only.

Set `VITE_WS_URL` to point the client at a backend WebSocket server. If it is not set, the client tries `ws://localhost:8787`.

## Pull Request Checks

GitHub Actions runs CI on pull requests to `main`. The workflow installs dependencies with `npm ci`, runs `npm test`, and builds the frontend with `npm run build`.

See `AGENTS.md` for contributor guidance, `STEPS.md` for the roadmap, and `PROGRESS.md` for the current project checkpoint.
