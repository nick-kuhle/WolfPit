/**
 * Single entry point for the /api/auth/* surface (F14).
 *
 * Used by the TanStack Start server route `src/routes/api.auth.$.ts` (dev and
 * the deployed Nitro build). Keeping the guard + Better Auth dispatch together
 * here means the dev and deployed behavior cannot drift.
 *
 * Fail-closed: when the database (rate-limit store) is unreachable the guard
 * returns 503 before Better Auth is ever reached — a working DB is a
 * prerequisite for auth anyway.
 */
import { auth } from "./server";
import { guardAuthRequest } from "./rate-limit.server";

/** Rate-limit, then dispatch to Better Auth. Never throws for client errors. */
export async function handleAuthApiRequest(request: Request): Promise<Response> {
  const guard = await guardAuthRequest(request);
  if (guard.blocked) return guard.blocked;
  const res = await auth.handler(request);
  // Count failures / reset on success — AFTER Better Auth has verified, so
  // wrong-password attempts are the only thing that consumes the window.
  await guard.record(res);
  return res;
}
