---
name: frontend-gameplay-slice
description: Use when building or modifying the DudesNDungeons browser client, Canvas renderer, input, HUD, WebSocket integration, or gameplay UI.
---

# Frontend Gameplay Slice

Use this skill for client-side gameplay work in `src/client/`.

## Current Shape

The frontend uses Vite, TypeScript, and a vanilla Canvas renderer. Keep work scoped to the browser client unless the task explicitly includes backend or shared protocol changes.

Important areas:

- `src/client/rendering/` for Canvas drawing.
- `src/client/input/` for keyboard/control handling.
- `src/client/state/` for local preview and client-side state.
- `src/client/network/` for WebSocket connection and messages.
- `src/client/audio/` for microphone and proximity voice work.
- `src/client/ui/` and `src/client/styles.css` for HUD and interface.

## Implementation Guidance

Prefer small vertical slices that can be manually played. For now, keep Canvas code straightforward and pixel-art friendly: stable dimensions, `image-rendering: pixelated`, readable colors, and no large UI framework unless the project direction changes.

Do not let local preview state become authoritative game logic. When backend snapshots are available, render server state and send intent messages rather than client-owned positions, health, loot, or combat results.

When adding networked behavior, coordinate with `src/shared/protocol/` and use the PR contract notes for any assumptions.

## Verification

Run:

- `npm run typecheck:client` for client-only TypeScript changes.
- `npm run build:client` for render/network/UI changes.
- `npm run build` if shared code or project config changed.

For visible changes, start the dev server with `npm run dev:client`, inspect the page in the browser when practical, and include screenshots or a short recording in the PR.
