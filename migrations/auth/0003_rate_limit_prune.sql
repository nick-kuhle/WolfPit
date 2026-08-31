-- Prune support for wolfpit_rate_limit (review fix, 2026-08-30):
-- bumpCount now deletes rows whose window is older than the previous one, so
-- attacker-rotated keys (emails/IPs) cannot grow the table without bound.
-- The index keeps that DELETE cheap; rows live at most ~2 windows regardless.
create index if not exists wolfpit_rate_limit_window_idx
  on wolfpit_rate_limit (window_start);
