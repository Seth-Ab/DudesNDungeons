import { z } from "zod";
import { MAX_VOICE_SIGNAL_LENGTH } from "../constants/game.js";

/**
 * WebRTC handshake payloads. The server relays these between peers without interpreting them, so
 * the only guarantees enforced here are shape and length.
 */
export const voiceSignalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("offer"),
    sdp: z.string().max(MAX_VOICE_SIGNAL_LENGTH),
  }),
  z.object({
    kind: z.literal("answer"),
    sdp: z.string().max(MAX_VOICE_SIGNAL_LENGTH),
  }),
  z.object({
    kind: z.literal("iceCandidate"),
    candidate: z.string().max(MAX_VOICE_SIGNAL_LENGTH),
    sdpMid: z.string().max(256).nullable(),
    sdpMLineIndex: z.number().int().nonnegative().nullable(),
  }),
]);
export type VoiceSignal = z.infer<typeof voiceSignalSchema>;
