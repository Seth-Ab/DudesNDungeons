import { test, type BrowserContext } from "@playwright/test";

/**
 * Contexts made with `browser.newContext()` are not closed when the test ends, only the `page`
 * fixture's are. Left open, their game pages keep rendering and slow whichever spec the worker runs
 * next, so the first walking spec after them timed out on CI. Call this once at the top of a spec
 * and pass each new context through the returned function; they are closed after every test, a
 * failed one included.
 */
export function trackContexts(): (context: BrowserContext) => BrowserContext {
  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(opened.splice(0).map((context) => context.close()));
  });
  return (context) => {
    opened.push(context);
    return context;
  };
}
