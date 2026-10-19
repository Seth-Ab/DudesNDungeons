/**
 * The fixed lists a character is designed from, shared so the client offers exactly what the server
 * accepts. A client sends ids from these lists and the server refuses anything else, so adding an
 * entry is a protocol change and removing one strands any saved look that uses it.
 *
 * See `docs/design/character-sprite-bible.html`, "Appearance on the wire".
 */
export const BODY_TYPES = ["guy", "girl"] as const;

export const SKIN_TONES = ["porcelain", "fair", "olive", "tan", "brown", "deep"] as const;

export const HAIR_STYLES = ["crop", "spiky", "long", "ponytail", "bun", "shaved"] as const;

export const HAIR_COLORS = [
  "black",
  "brown",
  "chestnut",
  "blonde",
  "ginger",
  "silver",
  "azure",
  "moss",
] as const;

/**
 * Assigned by the server in join order, never chosen. A slot takes the first colour nobody in the
 * session holds and keeps it until the slot is released, so there is one per party member.
 */
export const PARTY_COLORS = ["ember", "moss", "azure", "plum"] as const;

/**
 * The first entry of every list. A stand-in look for code that has to draw or send something before
 * the player has designed a character, and the fallback for a saved id that has since been removed.
 */
export const DEFAULT_APPEARANCE = {
  body: BODY_TYPES[0],
  skinTone: SKIN_TONES[0],
  hairStyle: HAIR_STYLES[0],
  hairColor: HAIR_COLORS[0],
} as const;
