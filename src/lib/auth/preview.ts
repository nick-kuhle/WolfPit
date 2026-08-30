/**
 * Shared LIVE-PREVIEW OAuth client (server-only — NEVER import from the client).
 *
 * The hosting platform serves each live preview on a dynamic host that can't be
 * pre-registered per app. The broker instead exposes ONE shared "preview"
 * client that accepts callbacks from any host matching
 * `WOLFPIT_PREVIEW_HOST_SUFFIX` (set the suffix to your platform's preview
 * host, e.g. `example.com` for `https://<app>.example.com`). Baking it here
 * lets the live preview do REAL sign-in — no demo/mock users — with no
 * platform injection. When deployed the deployer injects a per-app
 * `WOLFPIT_AUTH_*` that overrides these (see `server.ts`).
 *
 * These MUST equal the broker's `WOLFPIT_PREVIEW_CLIENT_ID` /
 * `WOLFPIT_PREVIEW_CLIENT_SECRET` (set in the broker's env; the broker stores
 * only the secret's `base64url(SHA-256)` hash). This is a dedicated,
 * low-privilege client (preview-only) — rotate it by regenerating the broker
 * env var and this constant together.
 */
export const PREVIEW_CLIENT_ID = "wolfpit_preview";
// SECURITY: not committed. From env only; if absent, federated preview sign-in
// stays off (fail-closed — see authConfigured in server.ts). The previous
// committed secret is COMPROMISED and must be rotated on the broker.
export const PREVIEW_CLIENT_SECRET =
  process.env.WOLFPIT_PREVIEW_CLIENT_SECRET?.trim() || "";

/**
 * The shared auth broker issuer (OIDC discovery lives under it). Never
 * hardcoded: set `WOLFPIT_AUTH_ISSUER` (deployed) or `WOLFPIT_PREVIEW_ISSUER`
 * (live preview). No value = no broker federation = fail-closed.
 */
export const PREVIEW_ISSUER = process.env.WOLFPIT_PREVIEW_ISSUER?.trim() || "";

/**
 * Host patterns whose callbacks the preview client accepts. Better Auth derives
 * the live preview's real origin from the request host and validates it against
 * this list (wildcard-matched), so the OAuth `redirect_uri` becomes the
 * concrete `https://<preview-host>/api/auth/oauth2/callback/...` the broker
 * allows. Empty when unset: preview federation stays off.
 *
 * Set e.g. `WOLFPIT_PREVIEW_HOST_SUFFIX=example.com` to accept
 * `*.example.com` preview callbacks.
 */
const previewSuffix = process.env.WOLFPIT_PREVIEW_HOST_SUFFIX?.trim() || "";
export const PREVIEW_ALLOWED_HOSTS: readonly string[] = previewSuffix
  ? [`*.${previewSuffix}`]
  : [];
