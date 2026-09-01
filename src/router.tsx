import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { installStaleChunkGuard } from "@/lib/stale-chunk";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // No-op on the server; on the client it recovers a tab left open across a
  // deploy instead of showing it a dead "module script failed" screen.
  installStaleChunkGuard();
  return createRouter({ routeTree, defaultErrorComponent: AppErrorComponent });
}
