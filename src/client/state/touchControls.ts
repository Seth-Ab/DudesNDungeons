/**
 * Matches a device whose primary pointer is a finger. The HUD's Attack and Emote buttons exist for
 * these players only; keyboard and mouse players have bound keys, shown on the hotbar and prompt.
 */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

/** The slice of `MediaQueryList` the rule reads, so a test can stub `matchMedia`. */
export interface PointerQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
}

/**
 * Calls `onChange` now with whether the touch buttons should show, and again whenever a hybrid
 * device switches its primary pointer. Returns a function that stops following it.
 */
export function followTouchControls(
  matchMedia: (query: string) => PointerQuery,
  onChange: (visible: boolean) => void,
): () => void {
  const query = matchMedia(COARSE_POINTER_QUERY);
  const listener = (event: { matches: boolean }): void => onChange(event.matches);
  query.addEventListener("change", listener);
  onChange(query.matches);
  return () => query.removeEventListener("change", listener);
}
