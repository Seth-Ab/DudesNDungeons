export type ToastSeverity = "info" | "warning" | "error";

export interface Toast {
  key: string;
  text: string;
  severity: ToastSeverity;
  expiresAt: number;
}

export const DEFAULT_TOAST_TTL_MS: Record<ToastSeverity, number> = {
  info: 6000,
  warning: 8000,
  error: 8000,
};

const DEFAULT_MAX_VISIBLE = 4;

/**
 * The HUD's one place for transient messages. Each message has a `key` naming its source (the hub
 * gate, the torch warning, the last error), and the queue de-dupes on it the way the old per-source
 * lines did: the HUD offers the current text of every source on each snapshot, and a text that is
 * already showing, or has already shown and expired, is not queued again. Clearing a source forgets
 * its text, so the same message appears again the next time the condition recurs.
 *
 * Time is passed in rather than read, so expiry is deterministic.
 */
export function createToastQueue(maxVisible = DEFAULT_MAX_VISIBLE) {
  let toasts: Toast[] = [];
  // The last text offered per source, whether or not its toast is still on screen.
  const lastOffered = new Map<string, string>();
  // Ids of once-only messages that have shown; clearing a source does not forget them.
  const shownOnce = new Set<string>();

  return {
    /** Returns true when the visible toasts changed. */
    show(
      key: string,
      text: string,
      severity: ToastSeverity,
      now: number,
      ttlMs: number = DEFAULT_TOAST_TTL_MS[severity],
      onceId?: string,
    ): boolean {
      if (text === "") return this.clear(key);
      // A once-only message has had its turn, even if its source went quiet and came back since.
      if (onceId !== undefined) {
        if (shownOnce.has(onceId)) return false;
        shownOnce.add(onceId);
      }
      if (lastOffered.get(key) === text) return false;

      lastOffered.set(key, text);
      const toast: Toast = { key, text, severity, expiresAt: now + ttlMs };
      const existing = toasts.findIndex((candidate) => candidate.key === key);
      if (existing >= 0) {
        // A source updates in place (a countdown) instead of stacking a toast per tick.
        toasts[existing] = toast;
      } else {
        toasts.push(toast);
        // Oldest out first when more sources speak than there is room for.
        if (toasts.length > maxVisible) toasts = toasts.slice(toasts.length - maxVisible);
      }
      return true;
    },

    /** The source has nothing to say any more. Returns true when a toast was removed. */
    clear(key: string): boolean {
      lastOffered.delete(key);
      const before = toasts.length;
      toasts = toasts.filter((toast) => toast.key !== key);
      return toasts.length !== before;
    },

    /** Drops toasts past their lifetime. Returns true when any were removed. */
    expire(now: number): boolean {
      const before = toasts.length;
      toasts = toasts.filter((toast) => toast.expiresAt > now);
      return toasts.length !== before;
    },

    visible(): readonly Toast[] {
      return toasts;
    },
  };
}
