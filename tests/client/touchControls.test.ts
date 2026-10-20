import { describe, expect, it } from "vitest";
import { COARSE_POINTER_QUERY, followTouchControls, type PointerQuery } from "../../src/client/state/touchControls.js";

/** A stubbed `matchMedia` whose single query can be flipped, as a hybrid device switching input would. */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const queries: string[] = [];
  const query: PointerQuery & { matches: boolean } = {
    matches: initial,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    queries,
    listeners,
    matchMedia: (text: string) => {
      queries.push(text);
      return query;
    },
    set(matches: boolean) {
      query.matches = matches;
      for (const listener of listeners) listener({ matches });
    },
  };
}

describe("followTouchControls", () => {
  it("asks for a coarse pointer", () => {
    const media = stubMatchMedia(false);
    followTouchControls(media.matchMedia, () => {});
    expect(media.queries).toEqual([COARSE_POINTER_QUERY]);
    expect(COARSE_POINTER_QUERY).toBe("(pointer: coarse)");
  });

  it("hides the buttons on a fine pointer and shows them on a coarse one", () => {
    const fine: boolean[] = [];
    followTouchControls(stubMatchMedia(false).matchMedia, (visible) => fine.push(visible));
    expect(fine).toEqual([false]);

    const coarse: boolean[] = [];
    followTouchControls(stubMatchMedia(true).matchMedia, (visible) => coarse.push(visible));
    expect(coarse).toEqual([true]);
  });

  it("follows the query changing at runtime", () => {
    const media = stubMatchMedia(false);
    const seen: boolean[] = [];
    followTouchControls(media.matchMedia, (visible) => seen.push(visible));

    media.set(true);
    media.set(false);
    expect(seen).toEqual([false, true, false]);
  });

  it("stops following once disposed", () => {
    const media = stubMatchMedia(true);
    const seen: boolean[] = [];
    const stop = followTouchControls(media.matchMedia, (visible) => seen.push(visible));

    stop();
    media.set(false);
    expect(seen).toEqual([true]);
    expect(media.listeners.size).toBe(0);
  });
});
