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
Hub/run transitions, downed-player loss, and deliberate torches are recorded in
`docs/decisions/0009-hub-and-run-lifecycle.md`.

## Requirements

- Node.js 22.12 or newer (Vitest 5 requires `^22.12.0 || >=24.0.0`).

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
- `POST /sessions` - create a party hub. Returns `{ sessionId, roomCode }`; share the room code with
  the party.
- `ws://localhost:8080` - gameplay. Connect, then send `joinSession` with the room code.

A session must exist before anyone can join it. One player calls `POST /sessions`, then everyone
joins its hub over WebSocket. A standing player can use the dungeon gate only when every reserved
party member is connected and ready. Fresh joins wait during a run; reconnects remain available.

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
- `npm run bench:tick` - time one server tick (simulation, visibility, snapshot serialization) for a seeded four-player run. Use it to check that a performance change helps.
- `npm test` - run the test suite once.
- `npm run test:watch` - run tests in watch mode.
- `npm run lint` - lint the project.
- `npm run typecheck` - type-check server, shared, tests, and client code without emitting.

## Project Layout

- `src/client/` - browser UI, rendering, input, local state, network client, and WebRTC audio.
- `src/server/` - authoritative dungeon state, sessions, WebSocket networking, and voice signaling.
- `src/shared/` - protocol definitions, shared game helpers, constants, and TypeScript types.
- `content/` - editable game data for dungeons, items, monsters, and skills. See below.
- `data/` - persistent server state, currently player profiles. Created on demand and gitignored.
- `assets/` - sprites, maps, audio, and UI media.
- `tests/` - client, server, shared, and end-to-end tests.
- `docs/` - architecture notes and decision records.
- `scripts/` - local automation scripts.
- `config/` - non-secret configuration templates.
- `.agents/skills/` - canonical repo-local skills for repeated AI-agent and contributor workflows.
- `.claude/skills/` - Claude Code discovery symlinks to the canonical skills.

Use `/ticket <GitHub issue URL>` to run the repo-local ticket workflow: validate one approved issue,
create its branch, implement and verify the scoped work, commit and push it, and open a pull request.
The workflow does not merge the pull request. When invoked from a Herdr-managed pane with
`HERDR_ENV=1`, it opens a new tab, starts Claude there, and delegates the complete workflow with a
recursion guard; outside Herdr it runs in the current agent.

## Game Content

Monsters, items, room templates, and dungeons are JSON under `content/`, not code. Editing a
monster's damage or adding a room template is a file change and a server restart, with no rebuild.

- `content/monsters/` - one file per monster type, keyed by a kebab-case id such as `ash-imp`.
- `content/items/` - keys, tonics, wards, skill scrolls, and separately equipped torches.
- `content/skills/` - validated skill definitions for persistent player progression.
- `content/upgrades/` - validated, tiered improvements linked to skills.
- `content/dungeons/templates/` - room templates, each with tiles, doorways, lights, and spawn rules.
- `content/dungeons/` - dungeon definitions. `authored` places every entity by hand; `generated`
  stitches templates together at run time.

The whole catalog is validated when the server starts, and a mistake names the file and the field.
The checks go past shape: a template that spawns a monster which does not exist, a map with ragged
rows, or a room whose doorways do not connect through its own floor are all refused rather than
becoming a dungeon nobody can finish. `CONTENT_DIR` overrides where content is read from.

Generated dungeons are a pure function of their seed, which is recorded on the session, so a run can
be reproduced exactly from a bug report.

Items are active gameplay content: dungeon definitions spawn them and the server owns pickup,
inventory, and use. Players can drop an item at their feet or hand it to a nearby party member. The first skill-scroll slice is also live: a rare Scroll of Iron Will can spawn
in the boss room, occupies an inventory slot, and grants its server-resolved effect when used. A
scroll used in a dungeon is provisional until that player escapes; a wipe or abandonment loses it.
Upgrade acquisition and the full progression UI remain in Backend Step 11 and Frontend Step 10.
See `content/README.md` for the supported shapes and relationships.

Sessions begin in `content/dungeons/hub.json`. The hub is fully lit and has four torch pickups; no
torch is issued automatically. Escaping banks a standing player's inventory, while a downed player
or a full-party wipe loses current carried items.

## Player Profiles

Banked items and unlocked skills belong to a profile, which outlives both the session and the
server. Profiles live in `data/profiles.json`, which `DATA_DIR` relocates.

Identity is device-local, per the recorded checkpoint: real accounts are deferred. On a first join
the server issues a profile secret, sends it once, and keeps only a SHA-256 hash of it. The browser
stores it in local storage and sends it on every later join, in any room. Clearing that storage, or
playing from a different browser, starts a new profile - there is no way to recover a secret the
server never kept.

Two consequences worth knowing:

- One profile plays one party at a time. A second join with the same secret is refused with
  `profileInUse` while the first slot is live, including a slot held open for a disconnected player
  until its 60-second grace window closes. That is what stops one bank being spent twice.
- `data/profiles.json` is refused rather than ignored when it cannot be parsed, because starting
  with an empty store would overwrite everything on the first save.

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

Proximity voice is peer to peer over WebRTC. `VITE_ICE_SERVERS` takes a comma-separated list of
STUN/TURN URLs; left unset, the client uses `stun:stun.l.google.com:19302`, and set to an empty value
it uses none, which still works for players on one LAN. No TURN server is bundled, so players behind
strict NATs may not connect. Browsers only allow the microphone on `localhost` or HTTPS.

Because the dev client and the API are on different ports, the server sends
`Access-Control-Allow-Origin` on its HTTP routes. It allows any origin by default; set `CORS_ORIGIN`
to restrict it. WebSocket connections are not subject to CORS and need no such setting.

## Pull Request Checks

GitHub Actions runs CI on pull requests to `main`. The workflow installs dependencies with `npm ci`, runs `npm test`, and builds the server and frontend with `npm run build`.

See `AGENTS.md` for contributor guidance, `STEPS.md` for the roadmap, `PROGRESS.md` for the current project checkpoint, and `GAMEDESCRIPTION.md` for the owner-authored game vision (read-only for agents).
