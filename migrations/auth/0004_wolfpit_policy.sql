-- WP-07 / #13: server-side trading policy (pause + geo-fence).
--
-- Both flags used to live ONLY in the admin's browser: Zustand state persisted
-- to localStorage under "wolfpit-admin-v1", read only in client code. That made
-- them not controls at all:
--
--   * pause paused trading for the one operator who clicked it; every other
--     session kept trading. This is the switch you reach for during an incident.
--   * the geo-fence was lifted by any user who opened devtools and edited their
--     own localStorage. A compliance boundary enforced in client-side JavaScript
--     is not a boundary.
--
-- These now live in the shared app DB, in the same table family as the rate
-- limiter, so every serverless instance reads the SAME row and a flip applies
-- across all sessions immediately. Enforced in the server functions that accept
-- orders (see src/lib/admin/policy.server.ts), not in the client.
--
-- Ships at two byte-identical paths for the same reason as 0002: the canonical
-- copy is always applied, the migrations/auth/ copy keeps the auth-on copy step
-- uniform (_migrations keys on basename, so the second apply is a dedup no-op).
create table if not exists wolfpit_policy (
  key text primary key,              -- "listingsPaused" | "geoFenceUs"
  value boolean not null,
  reason text not null default '',   -- why it was set; shown in the admin UI
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
