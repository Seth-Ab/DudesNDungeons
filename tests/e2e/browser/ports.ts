/**
 * Ports the browser suite runs its own Vite and game server on. Playwright reuses whatever already
 * answers on these ports locally, so two worktrees running the suite at once must pick different
 * ones or the second run silently tests the first one's code. Unset, they are the dev defaults.
 */
export const CLIENT_PORT = readPort("CLIENT_PORT", 5173);
export const SERVER_PORT = readPort("SERVER_PORT", 8080);

/** Matches the client's game socket, for `page.routeWebSocket`. */
export const GAME_SOCKET = new RegExp(`:${SERVER_PORT}(/|$)`);

function readPort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a port number, got "${raw}".`);
  }
  return port;
}
