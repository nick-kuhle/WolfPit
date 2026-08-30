-- F14: shared brute-force throttle for credential auth. Fixed-window counters
-- keyed by id (`ip:<addr>` / `acct:<email>`), so EVERY app instance (serverless
-- or not) reads/writes the SAME row when DATABASE_URL is set — an attacker gets
-- 5 attempts per account per window ACROSS all instances, not per instance.
-- Applies automatically to Neon (deploy) and PGLite (preview) via the standard
-- migrations/ pipeline; see src/lib/auth/rate-limit.server.ts.
create table if not exists wolfpit_rate_limit (
  id text primary key,          -- "ip:<addr>" | "acct:<email>" | "pair:<ip>:<acct>"
  kind text not null,
  key text not null,
  count integer not null default 0,
  window_start integer not null -- epoch seconds // window (bucket id)
);
