import { expect, test, type WebSocket as PlaywrightWebSocket } from "@playwright/test";
import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import { carriedAlly, nearestDownedAlly, nearestInteraction, nearestLoot } from "../../../src/client/state/reach.js";
import type { SessionView } from "../../../src/client/network/sessionState.js";
import type { ServerMessage } from "../../../src/shared/protocol/index.js";

/**
 * Judges whether the rendered contextual action prompt (`.hud__prompt`) communicates the same
 * action a human would expect given the actual game state, independent of its exact wording.
 *
 * Requires early access to TypeSafe's Jev model (`TYPESAFE_API_KEY`). Most contributors don't have
 * that yet, so this spec skips itself rather than failing CI or blocking anyone without a key.
 * `npm run test:e2e` stays green either way.
 */
test.describe("contextual action prompt matches the real game state (jev)", () => {
  test.skip(!process.env.TYPESAFE_API_KEY, "requires TYPESAFE_API_KEY (Jev early access) — skipped without it");

  test("the on-screen prompt names the same action reach.ts expects", async ({ page }) => {
    const playerName = `Investigator-${Date.now()}`;
    const received: ServerMessage[] = [];

    // The browser's own socket, not a second party member: a player always sees themselves
    // regardless of visibility/fog, so this sidesteps the hub's torch-gated line of sight rather
    // than fighting it with a second, possibly-blind, observer connection.
    page.on("websocket", (ws: PlaywrightWebSocket) => {
      ws.on("framereceived", (frame) => {
        if (typeof frame.payload !== "string") return;
        received.push(JSON.parse(frame.payload) as ServerMessage);
      });
    });

    await page.goto("/");
    await page.getByPlaceholder("Your name").fill(playerName);
    await page.getByRole("button", { name: "Create a new dungeon" }).click();

    const joined = await waitFor(
      received,
      (message): message is Extract<ServerMessage, { type: "sessionJoined" }> =>
        message.type === "sessionJoined",
    );
    const snapshot = await waitFor(
      received,
      (message): message is Extract<ServerMessage, { type: "stateSnapshot" }> =>
        message.type === "stateSnapshot" && message.players.some((p) => p.id === joined.playerId),
    );

    const self = snapshot.players.find((p) => p.id === joined.playerId) ?? null;
    if (!self) throw new Error("our own snapshot never carried our own player");

    const view: SessionView = {
      phase: "inSession",
      selfId: self.id,
      roomCode: joined.roomCode,
      tickRate: joined.tickRate,
      tick: snapshot.tick,
      players: snapshot.players,
      visiblePlayerIds: snapshot.players.map((p) => p.id),
      dungeon: snapshot.dungeon,
      location: snapshot.location,
      run: snapshot.run,
      runOutcome: null,
      lastError: null,
      lastAction: null,
      staminaRefusals: 0,
    };

    // Same priority order as src/client/state/hudView.ts's actionPrompt(): what reach.ts says is
    // actually in reach right now, independent of whatever text the DOM happens to show.
    const carried = carriedAlly(view, self);
    const downed = !carried ? nearestDownedAlly(view, self.position) : null;
    const loot = !carried && !downed ? nearestLoot(view, self.position) : null;
    const target = !carried && !downed && !loot ? nearestInteraction(view, self.position) : null;

    const expectedCategory = carried
      ? "dropAlly"
      : downed
        ? "liftAlly"
        : loot
          ? "pickupLoot"
          : target?.kind === "door"
            ? "openDoor"
            : target?.kind === "exit"
              ? view.location === "hub"
                ? "enterDungeon"
                : "leaveDungeon"
              : "noPrompt";
    const expectedName = carried?.name ?? downed?.name ?? loot?.name ?? null;

    const promptLocator = page.locator(".hud__prompt");
    const hidden = await promptLocator.isHidden();
    const visibleText = hidden ? "" : ((await promptLocator.textContent()) ?? "");

    const client = new TypeSafeClient();
    const response = await client.systemOne({
      state: {
        renderedPrompt: { visibleText, hidden },
        situation: {
          carriedAllyName: carried?.name ?? null,
          downedAllyName: downed?.name ?? null,
          nearestLootName: loot?.name ?? null,
          nearestDoorInReach: target?.kind === "door",
          nearestExit: target?.kind === "exit" ? { location: view.location } : null,
        },
      },
      questions: {
        promptIntent: choice(
          "The player sees `renderedPrompt.visibleText` (e.g. `[F] Pick up Tonic`) on screen, or " +
            "nothing if `renderedPrompt.hidden` is true. `situation` describes what the game actually " +
            "considers in reach right now. Decide which single action the rendered prompt is telling " +
            "the player to take.",
          {
            dropAlly: "Tells the player to drop/set down the ally named in situation.carriedAllyName.",
            liftAlly: "Tells the player to lift/pick up the downed ally named in situation.downedAllyName.",
            pickupLoot: "Tells the player to pick up the item named in situation.nearestLootName.",
            openDoor: "Tells the player to open a door.",
            enterDungeon: "Tells the player to enter the dungeon through an exit.",
            leaveDungeon: "Tells the player to leave the dungeon through an exit.",
            noPrompt: "No actionable prompt is visible.",
          },
        ),
        ...(expectedName
          ? {
              nameMatchesTarget: noul(
                "renderedPrompt.visibleText names a specific target. Does that name match " +
                  `"${expectedName}", the target situation says should be named?`,
              ),
            }
          : {}),
      },
    });

    expect(
      response.answers.promptIntent.choice,
      `rendered "${visibleText}" (hidden=${hidden}) read as ${response.answers.promptIntent.choice}, ` +
        `expected ${expectedCategory}`,
    ).toBe(expectedCategory);

    if (expectedName) {
      expect(response.answers.nameMatchesTarget?.noul, `expected the prompt to name "${expectedName}"`).toBeGreaterThan(
        0.5,
      );
    }
  });
});

function waitFor<T extends ServerMessage>(
  inbox: ServerMessage[],
  matches: (message: ServerMessage) => message is T,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      const found = inbox.find(matches);
      if (found) {
        resolve(found);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("timed out waiting for a matching message"));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}
