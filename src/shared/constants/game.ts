/** Bumped whenever a breaking protocol change ships; clients on another version are rejected. */
export const PROTOCOL_VERSION = 27;

export const MAX_PARTY_SIZE = 4;

/**
 * World tiles per authored content tile.
 *
 * Content under `content/` is authored at a size a designer can read in a diff: a room template is
 * a dozen characters across. The world is built four times finer on each axis, so an authored tile
 * becomes a 4x4 block of world tiles and a dungeon covers sixteen times the area it reads as.
 *
 * That is what makes the dungeon expansive rather than cramped, per the level design in
 * `GAMEDESCRIPTION.md`. A corridor authored one tile wide is four world units across - about five
 * player widths - so four people can walk it abreast and slip past each other, instead of filing
 * through one at a time.
 *
 * Only tile coordinates scale. Anything already measured in world units, such as a light radius or
 * a monster's speed, is authored in world units and passes through untouched.
 */
export const TILE_SCALE = 4;

/**
 * How far sight and hearing grew alongside `TILE_SCALE`.
 *
 * Deliberately less than the tile scale. Scaling light by the full four would light the same
 * fraction of the map as before and the dungeon would feel no darker at all; at three, a torch
 * covers rather less of a room than it used to, so a party that splits up loses each other sooner.
 * Lighting is a core pillar in `GAMEDESCRIPTION.md`, and this is the knob that tunes it.
 */
export const LIGHT_SCALE = 3;

/**
 * How close a player must be for a monster to notice them without seeing them, in world units.
 * A wall is a full `TILE_SCALE` thick, so this reaches a player hugging the far side of a doorway
 * jamb or a corner but not one standing in the next room.
 */
export const MONSTER_HEARING_RANGE = 6;

/**
 * How long a monster keeps hunting after every player has left its aggro range before it gives up
 * and walks back to where it spawned.
 */
export const MONSTER_LEASH_MS = 4000;

/** Wind-up for a monster whose content does not set one. */
export const DEFAULT_MONSTER_WINDUP_MS = 500;

/** How a monster fights. `melee` is the original walk-up swing; the others are in `monsterAi`/`combat`. */
export const MONSTER_BEHAVIORS = ["melee", "ranged", "charger"] as const;

/**
 * Longest step a projectile or charge takes between collision checks, in world units. Smaller than
 * a body, so a fast mover cannot skip over a player or a one-tile wall within a single tick.
 */
export const MAX_MOTION_SUBSTEP = 0.2;

export const SERVER_TICK_RATE_HZ = 20;
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE_HZ;

/**
 * World units per second. Deliberately low: the movement model is slow free-roam.
 *
 * Raised from 2.5 alongside `TILE_SCALE`, but by well under the full four. Crossing the dungeon
 * now takes roughly 1.7 times as long as it did, so the map reads as large without a run
 * overrunning the 15-20 minute target length.
 */
export const PLAYER_MOVE_SPEED = 6;

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
/**
 * Movement penalty for carrying: a carrying player covers half the ground per step. Slow enough
 * that hauling a downed party member to the exit is a real cost, not a free action.
 */
export const CARRY_MOVE_SPEED_MULTIPLIER = 0.5;

export const PLAYER_ATTACK_DAMAGE = 6;
/** Center-to-center reach of a swing, in world units. */
export const PLAYER_ATTACK_RANGE = 1.2;
export const PLAYER_ATTACK_COOLDOWN_MS = 500;
/** A swing hits targets within 60 degrees either side of its direction: cos(60°). */
export const PLAYER_ATTACK_ARC_COS = 0.5;

/** Reach for picking up loot, opening doors, and using exits. */
export const INTERACT_RANGE = 1.2;

/**
 * Radius, in world units, visible around a player carrying a deliberately picked-up torch.
 *
 * One and a half authored tiles. A generated hall is 56 world tiles across, so a torch lights well under a
 * third of it and a party member at the far wall stays in the dark. It was 12.6 until a playtest
 * found the party kept each other in sight far too easily.
 */
export const PLAYER_TORCH_LIGHT_RADIUS = 6;

/**
 * How close, in world units, two standing players must be for their discovered maps to merge. Line
 * of sight is not required. Starts at one torch radius; tune it in playtest.
 */
export const PLAYER_MAP_SHARE_RANGE = PLAYER_TORCH_LIGHT_RADIUS;

/**
 * Radius for sparse fixed dungeon lighting such as wall torches or torch pillars. Smaller than a
 * carried torch, so a pillar marks a spot in the dark rather than lighting the room around it.
 */
export const FIXED_LIGHT_RADIUS = 5;

export const MAX_INVENTORY_SIZE = 3;

/**
 * Upper bound on any item's `maxStack`, and so on any stack count on the wire. Content picks the
 * real limit per item; this only keeps a typo from authoring a stack of thousands.
 */
export const MAX_STACK_SIZE = 99;

/** How a weapon is used. The weapon issues extend the weapon block per kind. */
export const WEAPON_KINDS = ["melee", "ranged"] as const;

/** Longest HUD blurb a consumable may carry. */
export const MAX_ITEM_DESCRIPTION_LENGTH = 80;

/**
 * Icons a consumable may wear in the HUD and on the floor. A content file picks one by name, so
 * adding a consumable never needs a protocol change, while adding art for a new icon still does.
 */
export const CONSUMABLE_ICONS = ["tonic", "ward", "draught", "flare", "salts"] as const;

/**
 * Who a consumable is used on. `self` items act on the user; `downedAlly` items, such as smelling
 * salts, need a downed party member in reach named as the target of `useItem`. Derived from content
 * on the server, so the client knows to ask for a target without ever seeing the effect itself.
 */
export const CONSUMABLE_TARGETS = ["self", "downedAlly"] as const;

/**
 * Distance in world units. Peers closer than this play at full volume.
 *
 * Shrunk alongside the torch so hearing keeps pace with sight: full volume ends at the rim of
 * `PLAYER_TORCH_LIGHT_RADIUS`, so someone fading out of your light starts fading out of earshot too.
 * Voice is also gated on visibility, so a peer you cannot see is silent at any distance.
 */
export const VOICE_FULL_VOLUME_DISTANCE = 6;
/**
 * Distance in world units at which a peer is fully attenuated. About four and a half torch radii,
 * so a torch seen down a long hall fades out rather than talking at full volume from across the room.
 */
export const VOICE_SILENCE_DISTANCE = 28;

export const ROOM_CODE_LENGTH = 6;
/** Excludes vowels (no accidental words) and 0/O/1/I (unambiguous when read aloud over voice). */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";

export const MAX_PLAYER_NAME_LENGTH = 24;

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
 * Hex characters in a profile secret: 16 random bytes, like a resume token.
 *
 * Unlike a resume token, which unlocks one slot for one grace window, this names everything a
 * device has ever banked and lasts as long as the profile does. The server issues it once, the
 * browser keeps it in local storage, and it is never broadcast to the party.
 */
export const PROFILE_SECRET_LENGTH = 32;

/**
 * How long a session with no players survives. Room creation is unauthenticated, so without this
 * a caller could grow the session map without bound just by asking for codes.
 */
export const EMPTY_SESSION_TTL_MS = 10 * 60_000;

export const MAX_VOICE_SIGNAL_LENGTH = 8192;

/**
 * Per-player voice signaling budget, as a token bucket: up to `VOICE_SIGNAL_BURST` signals at once,
 * refilled at `VOICE_SIGNAL_REFILL_PER_SECOND`. Connecting to a full party is an offer or answer
 * plus a trickle of ICE candidates per peer, usually well under ten each, so the burst covers a
 * whole mesh setup with room for a renegotiation. Past that, a client is flooding its peers.
 */
export const VOICE_SIGNAL_BURST = 48;
export const VOICE_SIGNAL_REFILL_PER_SECOND = 8;

/** Cap on a single inbound frame, measured in UTF-16 code units rather than bytes. */
export const MAX_CLIENT_MESSAGE_CHARS = 16384;

/**
 * Transport-level ceiling on one inbound WebSocket message, in bytes, enforced as the server's
 * `maxPayload` so an oversized frame is refused (close code 1009) before it is buffered whole,
 * decoded, or parsed. Without it `ws` accepts up to 100 MiB.
 *
 * Every UTF-16 code unit encodes to at most three UTF-8 bytes, so this is the largest frame that
 * could still pass the `MAX_CLIENT_MESSAGE_CHARS` check. Deriving it that way means no message the
 * protocol accepts - the largest is a voice signal carrying `MAX_VOICE_SIGNAL_LENGTH` characters of
 * SDP - is ever cut off by the transport. Frame headers are not counted against it; with
 * per-message deflate it bounds the inflated size, which also caps compression bombs.
 */
export const MAX_CLIENT_MESSAGE_BYTES = MAX_CLIENT_MESSAGE_CHARS * 3;
