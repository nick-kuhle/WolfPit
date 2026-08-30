-- Shared brute-force throttle for credential auth (/api/auth/*) AND the
-- admin panel login (guardAdminLogin): fixed-window counters keyed by id
-- ("ip:<addr>" / "acct:<email>" / "pair:…" / "admin-user:<name>"), so every
-- app instance — serverless or not — reads/writes the SAME row. An attacker
-- gets 5 attempts per account per window ACROSS all instances, not per
-- instance. Applied by BOTH migrators: PGLite at startup (src/lib/db.ts glob)
-- and Neon at build (scripts/migrate.mjs).
--
-- This file ships at TWO byte-identical paths, on purpose:
--   migrations/0002_wolfpit_rate_limit.sql  (canonical, ALWAYS applied — the
--     admin login throttle must exist even when the opt-in sign-in schema is
--     never copied up)
--   migrations/auth/0002_wolfpit_rate_limit.sql (template side; the auth-on
--     copy step stays uniform — _migrations keys on the basename, so copying
--     it up after the root copy applied is a dedup no-op)
create table if not exists wolfpit_rate_limit (
  id text primary key,          -- "ip:<addr>" | "acct:<email>" | "pair:<ip>:<acct>" | "admin-user:<name>"
  kind text not null,
  key text not null,
  count integer not null default 0,
  window_start integer not null -- epoch seconds // window (bucket id)
);
