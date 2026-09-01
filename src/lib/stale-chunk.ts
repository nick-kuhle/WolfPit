/**
 * Stale-build recovery.
 *
 * Every deploy renames the hashed chunks. A tab that was already open still
 * holds the OLD router manifest, so the next lazy route it navigates to tries
 * to import a filename that no longer exists on the CDN. Vite surfaces that as
 * "Importing a module script failed." / "Failed to fetch dynamically imported
 * module" — an alarming full-screen error for what is really just an
 * out-of-date tab.
 *
 * 2026-08-31: an operator hit exactly this on /admin right after a redeploy
 * (old /assets/admin-CznGl7bW.js -> 404, new deployment serves
 * /assets/admin-BxdQFtU4.js). Reloading fixes it, but nobody should have to
 * know that.
 *
 * So: reload ONCE, automatically. The bounded retry matters — a genuinely
 * broken deployment must not put the browser in a reload loop, so after
 * MAX_ATTEMPTS inside the window we stop and let the real error render.
 */
const KEY = "wolfpit:stale-chunk-reloads";
const MAX_ATTEMPTS = 2;
const WINDOW_MS = 60_000;

/**
 * Is this error the signature of a chunk that no longer exists on the server?
 * Deliberately narrow: a network blip or an application error must NOT trigger
 * a reload, or we would hide real failures behind a refresh.
 */
export function isStaleChunkError(reason: unknown): boolean {
  const msg =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : typeof reason === "string"
        ? reason
        : "";
  if (!msg) return false;
  return (
    /importing a module script failed/i.test(msg) ||
    /failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /'text\/html' is not a valid JavaScript MIME type/i.test(msg) ||
    /expected a JavaScript(?:-or-Wasm)? module script/i.test(msg)
  );
}

type Store = Pick<Storage, "getItem" | "setItem">;

/**
 * Record an attempt and report whether reloading is still allowed. Exported
 * for tests: the loop guard is the part that can hurt users if it is wrong.
 */
export function shouldReload(store: Store, now = Date.now()): boolean {
  let attempts: number[] = [];
  try {
    const raw = store.getItem(KEY);
    if (raw) attempts = (JSON.parse(raw) as number[]).filter((t) => now - t < WINDOW_MS);
  } catch {
    attempts = [];
  }
  if (attempts.length >= MAX_ATTEMPTS) return false;
  attempts.push(now);
  try {
    store.setItem(KEY, JSON.stringify(attempts));
  } catch {
    // Private-mode storage failure: allow the reload, just without a counter.
  }
  return true;
}

/** Wire the guard to the browser. No-op on the server. */
export function installStaleChunkGuard(): void {
  if (typeof window === "undefined") return;
  const recover = (why: string) => {
    if (!shouldReload(window.sessionStorage)) {
      console.error(`[app] stale chunk after ${MAX_ATTEMPTS} reloads (${why}) — not retrying`);
      return;
    }
    console.warn(`[app] this tab is running an older build (${why}) — reloading`);
    window.location.reload();
  };

  // Vite's own signal for a failed module preload.
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    recover("vite:preloadError");
  });

  // The router's lazy import rejects rather than emitting the Vite event.
  window.addEventListener("unhandledrejection", (event) => {
    if (isStaleChunkError((event as PromiseRejectionEvent).reason)) {
      event.preventDefault();
      recover("unhandledrejection");
    }
  });
  window.addEventListener("error", (event) => {
    if (isStaleChunkError((event as ErrorEvent).error ?? (event as ErrorEvent).message)) {
      recover("error");
    }
  });
}
