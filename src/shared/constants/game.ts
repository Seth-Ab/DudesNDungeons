/** Bumped whenever a breaking protocol change ships; clients on another version are rejected. */
export const PROTOCOL_VERSION = 1;

export const MAX_PARTY_SIZE = 4;

export const SERVER_TICK_RATE_HZ = 20;
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE_HZ;

/** World units per second. Deliberately low: the movement model is slow free-roam. */
export const PLAYER_MOVE_SPEED = 2.5;

export const PLAYER_MAX_HEALTH = 100;

/** Distance in world units. Peers closer than this play at full volume. */
export const VOICE_FULL_VOLUME_DISTANCE = 3;
/** Distance in world units at which a peer is fully attenuated. */
export const VOICE_SILENCE_DISTANCE = 14;

export const ROOM_CODE_LENGTH = 6;
/** Excludes vowels (no accidental words) and 0/O/1/I (unambiguous when read aloud over voice). */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";

export const MAX_PLAYER_NAME_LENGTH = 24;

export const MAX_VOICE_SIGNAL_LENGTH = 8192;

/** Cap on a single inbound frame, measured in UTF-16 code units rather than bytes. */
export const MAX_CLIENT_MESSAGE_CHARS = 16384;
