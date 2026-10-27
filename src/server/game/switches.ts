import type { DoorState, SwitchState } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";

/**
 * Server-resolved switches and seal locks.
 *
 * A switch stays on once lit. A seal door opens when every switch in its group is on, and once
 * open it never closes or reseals. The client only ever sends an interact intent: whether a
 * brazier lights is the server's call, from where the player stands and whether they carry a lit torch.
 */

/** Whether the player may light this switch: a brazier takes a lit carried torch; the rest are not lit this way yet. */
function canLight(player: SessionPlayer, lever: SwitchState): boolean {
  return lever.kind === "brazier" && player.carryingTorch && player.torchLit;
}

/**
 * Lights a switch the player already reaches. False, changing nothing, when they cannot light this
 * kind (no lit torch) or it is already on, so a second light is a refusal rather than a second effect.
 * Opens any seal door this completes.
 */
export function lightSwitch(session: Session, player: SessionPlayer, lever: SwitchState): boolean {
  if (lever.active || !canLight(player, lever)) return false;

  lever.active = true;
  openSealedDoors(session);
  return true;
}

/** Whether a seal lock's group has switches and all of them are on. An empty group never opens. */
function groupActive(session: Session, groupId: string): boolean {
  const group = session.dungeon.switches.filter((lever) => lever.groupId === groupId);
  return group.length > 0 && group.every((lever) => lever.active);
}

/** Opens every seal door whose group is fully active, clearing its lock. Open doors are left alone. */
export function openSealedDoors(session: Session): DoorState[] {
  const opened: DoorState[] = [];
  for (const door of session.dungeon.doors) {
    if (door.open || door.lock?.type !== "seal" || !groupActive(session, door.lock.groupId)) continue;
    door.lock = null;
    door.open = true;
    opened.push(door);
  }
  return opened;
}
