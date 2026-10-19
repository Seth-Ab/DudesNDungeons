/**
 * The emotes a player can send, as fixed ids. A client sends one of these and the server refuses
 * anything else, so adding an entry is a protocol change. Order is the wheel's order, and the
 * number key that picks each one while the wheel is open.
 */
export const EMOTES = ["wave", "cheer", "point", "bow", "dance", "followMe", "wait", "help"] as const;
export type EmoteKind = (typeof EMOTES)[number];

/** The one emote a downed player may still send. */
export const DOWNED_EMOTE: EmoteKind = "help";

/**
 * Per-player emote budget, as a token bucket like the voice signal one: one emote at a time,
 * refilled once a second. A bubble lasts about two seconds, so this is already faster than anyone
 * can read them; past it, a client is spamming the party.
 */
export const EMOTE_BURST = 1;
export const EMOTE_REFILL_PER_SECOND = 1;
