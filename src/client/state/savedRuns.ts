const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long the player has spent in the run, such as "34 min in" or "1 h 5 min in". */
export function formatTimePlayed(playedMs: number): string {
  const minutes = Math.floor(Math.max(0, playedMs) / MINUTE_MS);
  if (minutes < 1) return "under a minute in";
  if (minutes < 60) return `${minutes} min in`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} h in` : `${hours} h ${remainder} min in`;
}

/** When a save was last played, relative to `now`: "just now", "2h ago", "yesterday", "5d ago". */
export function formatLastPlayed(lastPlayedAt: number, now: number): string {
  const elapsed = Math.max(0, now - lastPlayedAt);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  const days = Math.floor(elapsed / DAY_MS);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/** The card's title: the character, and the dungeon when the save recorded one. */
export function savedRunTitle(characterName: string, dungeonName: string | null): string {
  return dungeonName === null ? characterName : `${characterName} · ${dungeonName}`;
}

/** The card's detail line: room, time in the run, and when it was last played. */
export function savedRunDetails(
  card: { roomCode: string; playedMs: number; lastPlayedAt: number },
  now: number,
): string {
  return `Room ${card.roomCode} · ${formatTimePlayed(card.playedMs)} · ${formatLastPlayed(card.lastPlayedAt, now)}`;
}
