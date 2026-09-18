/** Bumped whenever a breaking protocol change ships; clients on another version are rejected. */
export const PROTOCOL_VERSION = 6;

export const MAX_PARTY_SIZE = 4;

export const SERVER_TICK_RATE_HZ = 20;
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE_HZ;

/** World units per second. Deliberately low: the movement model is slow free-roam. */
export const PLAYER_MOVE_SPEED = 2.5;

export const PLAYER_MAX_HEALTH = 100;

/**
 * Resistance is the general defensive stat from `GAMEDESCRIPTION.md`. It never regenerates: only
 * consumables and, later, unlocked skills raise it, and time in the dungeon takes it away.
 */
export const PLAYER_MAX_RESISTANCE = 100;
export const PLAYER_BASE_RESISTANCE = 40;
/**
 * A hit is scaled by `scale / (scale + resistance)`. Diminishing returns, so stacking resistance is
 * always worth something and no amount of it makes a player immune.
 */
export const RESISTANCE_DAMAGE_SCALE = 100;

/**
 * How long a player may stay in the dungeon before resistance starts falling. Chosen against the
 * 15-20 minute target run length: a party moving at pace escapes before decay ever bites.
 */
export const RESISTANCE_DECAY_GRACE_MS = 10 * 60_000;
/** Resistance lost per second once the grace period is over. Base resistance is gone in ~6.7 min. */
export const RESISTANCE_DECAY_PER_SECOND = 0.1;
/** How far ahead of the grace period the client warns the player. Shared so both sides agree. */
export const RESISTANCE_DECAY_WARNING_MS = 60_000;

/** Resistance restored by a warding consumable. */
export const WARD_RESISTANCE_AMOUNT = 25;

export const PLAYER_MAX_STAMINA = 100;
/** Stamina restored per second. Refills an empty bar in a little over eight seconds. */
export const STAMINA_REGEN_PER_SECOND = 12;
/**
 * Cost of one swing. Against `PLAYER_ATTACK_COOLDOWN_MS` and the regen rate, a full bar buys about
 * eleven back-to-back swings before combat is paced by stamina rather than by the cooldown.
 */
export const ATTACK_STAMINA_COST = 15;
/** Cost of lifting an object or a downed player. Spent by Backend step 12. */
export const LIFT_STAMINA_COST = 20;
/** Drain per second while carrying something. Spent by Backend step 12. */
export const CARRY_STAMINA_DRAIN_PER_SECOND = 6;

export const PLAYER_ATTACK_DAMAGE = 6;
/** Center-to-center reach of a swing, in world units. */
export const PLAYER_ATTACK_RANGE = 1.2;
export const PLAYER_ATTACK_COOLDOWN_MS = 500;
/** A swing hits targets within 60 degrees either side of its direction: cos(60°). */
export const PLAYER_ATTACK_ARC_COS = 0.5;

/** Reach for picking up loot, opening doors, and using exits. */
export const INTERACT_RANGE = 1.2;

/** Radius, in world units, visible around a player carrying the default hub torch. */
export const PLAYER_TORCH_LIGHT_RADIUS = 4.2;

/** Radius for sparse fixed dungeon lighting such as wall torches or torch pillars. */
export const FIXED_LIGHT_RADIUS = 3.2;

/** Radius for monsters that glow enough to reveal nearby geometry. */
export const MONSTER_GLOW_LIGHT_RADIUS = 2.4;

/** How long a downed player waits before returning at a spawn point with full health. */
export const PLAYER_RESPAWN_MS = 5_000;

export const MAX_INVENTORY_SIZE = 3;

export const TONIC_HEAL_AMOUNT = 35;

/** Distance in world units. Peers closer than this play at full volume. */
export const VOICE_FULL_VOLUME_DISTANCE = 3;
/** Distance in world units at which a peer is fully attenuated. */
export const VOICE_SILENCE_DISTANCE = 14;

export const ROOM_CODE_LENGTH = 6;
/** Excludes vowels (no accidental words) and 0/O/1/I (unambiguous when read aloud over voice). */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";

export const MAX_PLAYER_NAME_LENGTH = 24;

/** Legacy fallback spawn for UI preview code before the first server snapshot arrives. */
export const PLAYER_SPAWN_POSITION = { x: 0, y: 0 } as const;
export const PLAYER_SPAWN_FACING = { x: 0, y: 1 } as const;

/**
 * How long a disconnected player keeps their slot, position, and health before the server drops
 * them. Long enough to survive a browser refresh or a brief network drop, short enough that a
 * four-slot party is not held hostage by someone who closed the tab.
 */
export const RECONNECT_GRACE_MS = 60_000;

/** Hex characters in a resume token: 16 random bytes, so guessing one is not practical. */
export const RESUME_TOKEN_LENGTH = 32;

/**
 * How long a session with no players survives. Room creation is unauthenticated, so without this
 * a caller could grow the session map without bound just by asking for codes.
 */
export const EMPTY_SESSION_TTL_MS = 10 * 60_000;

export const MAX_VOICE_SIGNAL_LENGTH = 8192;

/** Cap on a single inbound frame, measured in UTF-16 code units rather than bytes. */
export const MAX_CLIENT_MESSAGE_CHARS = 16384;
