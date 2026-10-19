import { MAX_CLIENT_MESSAGE_CHARS } from "../constants/game.js";
import { clientMessageSchema, type ClientMessage } from "./clientMessages.js";
import { serverMessageSchema, type ServerMessage } from "./serverMessages.js";

export * from "./clientMessages.js";
export * from "./serverMessages.js";
export * from "./voice.js";

/**
 * A failed parse names the message `type` it claimed, when it claimed a known one, so the server can
 * answer a malformed message with a code specific to it rather than a bare `invalidMessage`.
 */
export type ParseResult<T> =
  | { ok: true; message: T }
  | { ok: false; error: string; claimedType?: string };

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set(
  clientMessageSchema.options.map((option) => option.shape.type.value),
);

function claimedTypeOf(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || !("type" in payload)) return undefined;
  const { type } = payload;
  return typeof type === "string" && CLIENT_MESSAGE_TYPES.has(type) ? type : undefined;
}

/**
 * The server's trust boundary. Every inbound frame passes through here, so a malformed or
 * oversized payload is rejected before any game code sees it.
 */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  if (raw.length > MAX_CLIENT_MESSAGE_CHARS) {
    return { ok: false, error: "Message exceeds the maximum allowed size" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Message is not valid JSON" };
  }

  const result = clientMessageSchema.safeParse(payload);
  if (!result.success) {
    const claimedType = claimedTypeOf(payload);
    return {
      ok: false,
      error: formatIssues(result.error),
      ...(claimedType === undefined ? {} : { claimedType }),
    };
  }

  return { ok: true, message: result.data };
}

/** Used by client tests and tooling; the client trusts the server but still checks shape. */
export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Message is not valid JSON" };
  }

  const result = serverMessageSchema.safeParse(payload);
  if (!result.success) {
    return { ok: false, error: formatIssues(result.error) };
  }

  return { ok: true, message: result.data };
}

export function serializeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function serializeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}
