export const SAVE_QUIT_LABEL = "Save and quit";
export const SAVE_QUIT_PENDING_LABEL = "Saving...";

export function saveQuitButtonLabel(pending: boolean): string {
  return pending ? SAVE_QUIT_PENDING_LABEL : SAVE_QUIT_LABEL;
}

/**
 * Whether Save and quit is still waiting on the server. A refusal ends the wait, and so does
 * leaving the dungeon (the accepted answer returns the player to the lobby).
 */
export function saveQuitStillPending(pending: boolean, refusal: string | null, inDungeon: boolean): boolean {
  return pending && inDungeon && refusal === null;
}

/** The lobby's confirmation that a run was saved, naming the room and how to continue it. */
export function saveConfirmation(roomCode: string): { title: string; text: string } {
  return {
    title: "Run saved",
    text: `Room ${roomCode} is saved with your progress. Enter your name and press Join dungeon to continue it.`,
  };
}
