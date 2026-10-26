import { z } from "zod";
import { EMOTES } from "../constants/emotes.js";
import {
  contentIdSchema,
  cosmeticSlotSchema,
  entityIdSchema,
  playerAppearanceSchema,
  playerIdSchema,
  playerNameSchema,
  profileSecretSchema,
  resumeTokenSchema,
  roomCodeSchema,
  vector2Schema,
} from "../types/core.js";
import { voiceSignalSchema } from "./voice.js";

/**
 * `resumeToken` is the token from an earlier `sessionJoined` in the same room. Present, it asks the
 * server to reclaim that player slot with its position, health, and ready state intact. Absent or
 * no longer valid, the join is treated as a brand new player.
 *
 * `profileSecret` names the roguelite profile this device already owns, from an earlier
 * `sessionJoined` in any room. Absent or unknown to the server, a fresh profile is created and its
 * secret comes back once. The two credentials answer different questions: the resume token says
 * which slot in this room, the profile secret says whose bank and unlocks.
 *
 * `savedRun` answers a room whose save holds a run (decision 0015). Absent, a member of that run is
 * refused with `savedRunExists` so the client can ask; `continue` restores them into it; `discard`
 * deletes the whole room save (run and characters) and opens the room in the hub as a new one.
 * Meaningless, and ignored, for a room with no saved run.
 */
export const joinSessionSchema = z.object({
  type: z.literal("joinSession"),
  protocolVersion: z.number().int().nonnegative(),
  roomCode: roomCodeSchema,
  playerName: playerNameSchema,
  resumeToken: resumeTokenSchema.nullish(),
  profileSecret: profileSecretSchema.nullish(),
  savedRun: z.enum(["continue", "discard"]).nullish(),
});

/**
 * Asks for the saved runs the profile named by `profileSecret` can continue, before joining any
 * room. Answered with `savedRuns`; an unknown secret is answered with an empty list, since a fresh
 * device has no saves. Refused with `alreadyInSession` once joined.
 */
export const listSavedRunsSchema = z
  .object({
    type: z.literal("listSavedRuns"),
    profileSecret: profileSecretSchema,
  })
  .strict();

export const leaveSessionSchema = z.object({
  type: z.literal("leaveSession"),
});

/**
 * Leaves the run on purpose, keeping the sender's carry and position in the room save (decision
 * 0015). Unlike `leaveSession`, which abandons them. Dungeon only, and refused with `inCombat`
 * during a fight and `notPermitted` to a player who is downed or being carried. Carries nothing:
 * the server decides what is saved.
 */
export const saveAndQuitSchema = z
  .object({
    type: z.literal("saveAndQuit"),
  })
  .strict();

export const setReadySchema = z.object({
  type: z.literal("setReady"),
  ready: z.boolean(),
});

/**
 * The character a player designed, sent once after a `sessionJoined` that said `needsAppearance`.
 * Every field must be an id from the shared lists, with nothing extra; the server answers a bad one
 * with `invalidAppearance` and any call after the first with `appearanceLocked`.
 */
export const setAppearanceSchema = z.object({
  type: z.literal("setAppearance"),
  appearance: playerAppearanceSchema,
});

/**
 * A new name for the sender, allowed only while they are still designing (`needsAppearance`, no look
 * yet). Trimmed and length-checked like the join name; the server answers a name another player in
 * the room already uses (ignoring case) with `nameTaken`, a malformed one with `invalidName`, and a
 * player who has entered the hub with `nameLocked`. Success has no message of its own: the next
 * snapshot and roster carry the name.
 */
export const setNameSchema = z
  .object({
    type: z.literal("setName"),
    name: playerNameSchema,
  })
  .strict();

/**
 * Movement intent, never a position. `direction` is an unnormalized heading; the server normalizes
 * it, applies its own speed, and resolves collision. `sequence` lets the server tell the client
 * which intent a correction refers to.
 */
export const playerMoveIntentSchema = z.object({
  type: z.literal("playerMoveIntent"),
  sequence: z.number().int().nonnegative(),
  direction: vector2Schema,
});

/** Target is optional: the hybrid combat model allows directional swings that hit whatever is there. */
export const playerAttackSchema = z.object({
  type: z.literal("playerAttack"),
  sequence: z.number().int().nonnegative(),
  direction: vector2Schema,
  targetId: entityIdSchema.nullable(),
});

/**
 * Starts drawing the held bow toward `direction`. The server times the draw itself; there is no
 * strength to send, and none would be believed. Refused unless a bow is in hand with an arrow and
 * the stamina to start. Drawing again while already drawing restarts the draw.
 */
export const beginDrawSchema = z.object({
  type: z.literal("beginDraw"),
  sequence: z.number().int().nonnegative(),
  direction: vector2Schema,
});

/**
 * Looses the draw `beginDraw` started, toward `direction`. Range comes from how long the server saw
 * the draw held. A release with no draw in progress is refused, and one before the bow's minimum
 * draw time fires nothing and costs nothing.
 */
export const releaseDrawSchema = z.object({
  type: z.literal("releaseDraw"),
  sequence: z.number().int().nonnegative(),
  direction: vector2Schema,
});

/**
 * An interact intent names only its target. Which key a locked door takes is the server's to
 * decide, so a message carrying a key id of any kind is refused rather than having it ignored.
 * `choiceItemId` is the one extra a target may take: the scroll an altar's taker picks from its
 * offer. The server refuses it for any other target and refuses an altar take without it.
 */
export const playerInteractSchema = z
  .object({
    type: z.literal("playerInteract"),
    targetId: entityIdSchema,
    choiceItemId: contentIdSchema.optional(),
  })
  .strict();

export const pickupItemSchema = z.object({
  type: z.literal("pickupItem"),
  itemId: entityIdSchema,
});

/**
 * Uses an inventory item. `targetPlayerId` names the downed ally a `downedAlly` consumable (smelling
 * salts) is used on, and must be absent for anything else. The server checks the target's state,
 * reach, and the user's stamina itself.
 */
export const useItemSchema = z.object({
  type: z.literal("useItem"),
  itemId: entityIdSchema,
  targetPlayerId: playerIdSchema.nullish(),
});

/**
 * Turns a skill scroll into coin. Sent only after the player confirms the prompt a maxed `useItem`
 * opens. The server re-checks that the scroll is in the sender's inventory and its skill is at
 * `maxStacks` for them; the client never names an amount.
 */
export const convertSkillScrollSchema = z.object({
  type: z.literal("convertSkillScroll"),
  itemId: entityIdSchema,
});

/**
 * Buys one scroll from the hub skill shop. Names the stock entry by its scroll item id and never a
 * price or a coin amount: the server reads the price from content, and refuses outside the shop
 * room, when the entry is not in stock, unaffordable, with no free slot, or for a maxed skill.
 */
export const buySkillScrollSchema = z.object({
  type: z.literal("buySkillScroll"),
  itemId: contentIdSchema,
});

/**
 * Buys one cosmetic at the hub wardrobe stall, named by content id and never by price. The server
 * refuses outside the hub or the wardrobe room, for an unknown or already-owned id, one not in
 * stock right now, or one the profile cannot afford. A bought item is owned, not worn.
 */
export const buyCosmeticSchema = z.object({
  type: z.literal("buyCosmetic"),
  id: contentIdSchema,
});

/**
 * Wears an owned cosmetic in a slot, or takes that slot off with null. Only in the hub: in a
 * dungeon the look is fixed. The server refuses an item the profile does not own, or one that
 * fills a different slot.
 */
export const equipCosmeticSchema = z.object({
  type: z.literal("equipCosmetic"),
  slot: cosmeticSlotSchema,
  id: contentIdSchema.nullable(),
});

/** Puts a carried item (inventory or hand) on the floor at the sender's feet as loot anyone can pick up again. */
export const dropItemSchema = z.object({
  type: z.literal("dropItem"),
  itemId: entityIdSchema,
});

/** Hands a carried item (inventory or hand) to a standing, connected party member within reach who has a free slot. */
export const giveItemSchema = z.object({
  type: z.literal("giveItem"),
  itemId: entityIdSchema,
  targetPlayerId: playerIdSchema,
});

/**
 * Swaps the hand item with the named inventory item. With an empty hand it moves that item into
 * the hand. A null `itemId` stows the hand item into a free inventory slot.
 */
export const swapHeldSchema = z.object({
  type: z.literal("swapHeld"),
  itemId: entityIdSchema.nullable(),
});

/**
 * Takes an item out of the party vault into the sender's hand (a weapon, when it is empty) or a free
 * inventory slot, topping up carried stacks first. Hub only, from inside the vault room. Any standing
 * party member may take any item; the first request for it wins and every later one is refused.
 */
export const withdrawVaultItemSchema = z.object({
  type: z.literal("withdrawVaultItem"),
  itemId: entityIdSchema,
});

/** Stores a carried item (inventory or hand) in the party vault. Same place rules as a withdrawal. */
export const depositVaultItemSchema = z.object({
  type: z.literal("depositVaultItem"),
  itemId: entityIdSchema,
});

/** Lifts a downed party member within reach. Refused if either player is already carrying/carried. */
export const liftPlayerSchema = z.object({
  type: z.literal("liftPlayer"),
  targetPlayerId: playerIdSchema,
});

/** Explicitly drops whoever the sender is carrying. A no-op refusal if they are carrying nobody. */
export const dropCarrySchema = z.object({
  type: z.literal("dropCarry"),
});

export const emoteKindSchema = z.enum(EMOTES);

/**
 * A quick social signal, shown over the sender for a moment. The server refuses one from a player
 * with no character yet, anything but `help` from a downed player, and more than its rate allows.
 */
export const emoteSchema = z.object({
  type: z.literal("emote"),
  kind: emoteKindSchema,
});

export const voiceSignalMessageSchema = z.object({
  type: z.literal("voiceSignal"),
  targetPlayerId: playerIdSchema,
  signal: voiceSignalSchema,
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  joinSessionSchema,
  listSavedRunsSchema,
  leaveSessionSchema,
  saveAndQuitSchema,
  setReadySchema,
  setAppearanceSchema,
  setNameSchema,
  playerMoveIntentSchema,
  playerAttackSchema,
  beginDrawSchema,
  releaseDrawSchema,
  playerInteractSchema,
  pickupItemSchema,
  useItemSchema,
  convertSkillScrollSchema,
  buySkillScrollSchema,
  buyCosmeticSchema,
  equipCosmeticSchema,
  dropItemSchema,
  giveItemSchema,
  swapHeldSchema,
  withdrawVaultItemSchema,
  depositVaultItemSchema,
  liftPlayerSchema,
  dropCarrySchema,
  emoteSchema,
  voiceSignalMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage["type"];
