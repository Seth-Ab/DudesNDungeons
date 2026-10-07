import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameServer, type GameServer } from "../../src/server/gameServer.js";

/**
 * A clock that moves a fixed amount on every read. The server reads it at the start of a tick and
 * again at the end, so `step` is the duration each tick appears to take, whatever the machine does.
 */
function steppingClock(step: number): () => number {
  let reading = 0;
  return () => {
    reading += step;
    return reading;
  };
}

let server: GameServer | null = null;
let output: ReturnType<typeof vi.spyOn> | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  output?.mockRestore();
  output = null;
});

const slowLines = (): string[] =>
  (output?.mock.calls ?? [])
    .map((call: unknown[]) => String(call[0]))
    .filter((line: string) => line.startsWith("[tick]"));

describe("slow tick logging", () => {
  it("logs a tick that takes longer than the threshold", async () => {
    output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    server = createGameServer({ tickIntervalMs: 5, slowTickMs: 25, now: steppingClock(40) });
    await vi.waitFor(() => expect(slowLines().length).toBeGreaterThan(0));

    expect(slowLines()[0]).toContain("slow tick");
    expect(slowLines()[0]).toContain("0 session(s)");
  });

  it("logs once, not on every slow tick", async () => {
    output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Every tick reads as slow and 40 ms apart, so five-second throttling allows one line in the
    // first dozen ticks and the next only after about 125 more.
    server = createGameServer({ tickIntervalMs: 5, slowTickMs: 25, now: steppingClock(40) });
    await vi.waitFor(() => expect(slowLines().length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(slowLines()).toHaveLength(1);
  });

  it("stays quiet for a tick under the threshold", async () => {
    output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    server = createGameServer({ tickIntervalMs: 5, slowTickMs: 25, now: steppingClock(1) });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(slowLines()).toHaveLength(0);
  });

  it("stays quiet when logging is off", async () => {
    output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    server = createGameServer({ tickIntervalMs: 5, slowTickMs: 25, now: steppingClock(40), log: false });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(slowLines()).toHaveLength(0);
  });
});
