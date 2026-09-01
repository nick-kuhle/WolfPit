import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { isStaleChunkError, shouldReload } from "@/lib/stale-chunk";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  /*
   * A tab open across a deploy holds the previous build's chunk names, so its
   * next lazy route imports a filename the CDN no longer has. That surfaced
   * here as a full-screen "Something went wrong — Importing a module script
   * failed.", which reads like the app is broken when the fix is simply to
   * reload. Detect that one case and recover on the user's behalf; everything
   * else still renders the real error, because hiding failures behind a
   * refresh is how you end up debugging a reload loop.
   */
  const stale = isStaleChunkError(error);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!stale) return;
    if (typeof window === "undefined") return;
    if (!shouldReload(window.sessionStorage)) return;
    setReloading(true);
    window.location.reload();
  }, [stale]);

  if (stale) {
    return (
      <main
        className={
          "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
          "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
        }
      >
        <h1 className="text-lg font-semibold">
          {reloading ? "Loading the latest version…" : "A newer version is available"}
        </h1>
        <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          This tab was opened before the site was updated. Reloading picks up the new build.
        </p>
        {!reloading && (
          <button
            type="button"
            className="mt-2 h-11 rounded-md border border-zinc-300 px-4 text-sm dark:border-zinc-700"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        )}
      </main>
    );
  }

  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      }
    >
      <span className="text-red-500" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400">
        {error.message || "An unexpected error occurred. Try reloading the page."}
      </p>
    </main>
  );
}
