import { createFileRoute } from "@tanstack/react-router";

/**
 * The app's OWN Better Auth API surface at /api/auth/*.
 *
 * Server route (no component — never renders the app shell; a *.tsx page here
 * would paint the SPA and swallow the JSON/redirect responses). Runs on the
 * TanStack Start server in dev AND in the deployed Nitro build, so the auth
 * module (`src/lib/auth/server`) keeps its TanStack cookie bridge and the
 * `/auth/popup` dev middleware stays dev-only as documented in vite.config.ts.
 *
 * F14: the DB-backed throttle runs BEFORE Better Auth for every credential /
 * OAuth-initiation POST, fail-closed (503) when the store is unreachable. See
 * `src/lib/auth/rate-limit.server.ts`. OAuth callback GETs pass through.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleAuthApiRequest } = await import("@/lib/auth/api.server");
        return handleAuthApiRequest(request);
      },
      POST: async ({ request }) => {
        const { handleAuthApiRequest } = await import("@/lib/auth/api.server");
        return handleAuthApiRequest(request);
      },
    },
  },
});
