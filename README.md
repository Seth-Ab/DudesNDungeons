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

See `AGENTS.md` for contributor guidance, `STEPS.md` for the roadmap, and `PROGRESS.md` for the current project checkpoint.
