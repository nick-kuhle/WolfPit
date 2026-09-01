import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isMigrationFile, migrationName, pendingMigrations } from "./migration-plan.mjs";
import { projectRoot } from "./with-app-env.mjs";

/**
 * Every migration that ships under migrations/auth/ (the opt-in sign-in schema:
 * Better Auth tables + the F14 rate-limit table). The auth-on copy must move
 * ALL of them — copying only 0001 would silently skip wolfpit_rate_limit.
 */
function authMigrationNames() {
  const dir = join(projectRoot(), "migrations/auth");
  return readdirSync(dir).filter(isMigrationFile).sort();
}

/**
 * The auth-on copy of one auth migration and its source, or null when the app
 * has not turned sign-in on (the shipped state).
 */
function authSchemaCopy(root, name) {
  const copy = join(root, "migrations", name);
  const source = join(root, "migrations/auth", name);
  if (!existsSync(copy) || !existsSync(source)) return null;
  return { copy: readFileSync(copy, "utf8"), source: readFileSync(source, "utf8") };
}

test("_migrations keys on basename, not path", () => {
  assert.equal(migrationName("/migrations/0002_todos.sql"), "0002_todos.sql");
  assert.equal(migrationName("migrations/auth/0001_auth.sql"), "0001_auth.sql");
  assert.equal(migrationName("0001_auth.sql"), "0001_auth.sql");
});

test("a file already applied from another directory does not re-apply", () => {
  // The auth-on path copies migrations/auth/0001_auth.sql into the globbed
  // directory; a database that already has it must not run it twice.
  assert.deepEqual(pendingMigrations(["/migrations/0001_auth.sql"], ["0001_auth.sql"]), []);
});

test("pending migrations are returned in name order", () => {
  assert.deepEqual(
    pendingMigrations(
      ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql"],
      ["0001_a.sql"],
    ),
    [
      { name: "0002_b.sql", path: "/migrations/0002_b.sql" },
      { name: "0003_c.sql", path: "/migrations/0003_c.sql" },
    ],
  );
});

test("non-.sql entries are dropped (readdir also yields the auth/ directory)", () => {
  assert.equal(isMigrationFile("auth"), false);
  assert.deepEqual(pendingMigrations(["auth", "README.md"], []), []);
});

test("the sign-in schema ships outside the globbed directory (throttle is always-on)", () => {
  const migrationsDir = join(projectRoot(), "migrations");
  const rootFiles = readdirSync(migrationsDir).filter(isMigrationFile);
  // The Better Auth sign-in schema is OPT-IN: nothing but the always-on
  // throttle table (+ its prune index) may ship at the migrations/ root, or
  // the glob would apply sign-in tables to apps that never asked for them.
  // Always-on migrations: the ones that must exist whether or not an app turns
  // sign-in on. Anything else at this path would be applied to apps that never
  // asked for it, so this set is deliberately small and each entry justified.
  //
  //   0002/0003 — the brute-force throttle; the ADMIN login throttle needs it
  //               with sign-in off too.
  //   0004      — the trading policy table (WP-07 / #13). Pause and the
  //               geo-fence are server-owned controls that must bind every
  //               session, and they gate order-accepting server functions that
  //               run with sign-in off. Gating them behind the opt-in auth
  //               schema would make the incident switch unavailable in exactly
  //               the default configuration that ships.
  const ALWAYS_ON = new Set([
    "0002_wolfpit_rate_limit.sql",
    "0003_rate_limit_prune.sql",
    "0004_wolfpit_policy.sql",
  ]);
  assert.deepEqual(
    rootFiles.filter((f) => !ALWAYS_ON.has(f)),
    [],
    "unexpected non-always-on migration at migrations/ root",
  );
  // The throttle table ships at BOTH paths by design: the root copy is always
  // applied (the ADMIN login throttle needs it with sign-in off too), and the
  // auth/ copy keeps the auth-on step uniform — basename keying makes that
  // copy a dedup no-op. The byte-identity is asserted by the test below.
  assert.ok(
    rootFiles.includes("0002_wolfpit_rate_limit.sql"),
    "always-on throttle migration missing at migrations/ root",
  );
  assert.ok(
    rootFiles.includes("0003_rate_limit_prune.sql"),
    "always-on throttle prune migration missing at migrations/ root",
  );
  assert.ok(
    rootFiles.includes("0004_wolfpit_policy.sql"),
    "always-on trading policy migration missing at migrations/ root",
  );
  const authNames = authMigrationNames();
  // Both the Better Auth schema and the F14 rate-limit table must ship there —
  // a missing 0002 means sign-in-on deployments never get wolfpit_rate_limit.
  assert.ok(authNames.includes("0001_auth.sql"), "0001_auth.sql missing from migrations/auth/");
  assert.ok(
    authNames.includes("0002_wolfpit_rate_limit.sql"),
    "0002_wolfpit_rate_limit.sql missing from migrations/auth/",
  );
  assert.ok(
    authNames.includes("0004_wolfpit_policy.sql"),
    "0004_wolfpit_policy.sql missing from migrations/auth/",
  );
});

test("this workspace's auth schema copies are byte-identical to their sources", () => {
  // An edited copy diverges silently: basename keying skips it on a database
  // that already ran the original, and applies it on a fresh PGLite preview.
  for (const name of authMigrationNames()) {
    const pair = authSchemaCopy(projectRoot(), name);
    if (pair === null) continue; // sign-in off — nothing has been copied up
    assert.equal(
      pair.copy,
      pair.source,
      `migrations/${name} has been edited — it must stay a verbatim copy of migrations/auth/${name}`,
    );
  }
});

test("the copy check reads both files and catches an edit", () => {
  const root = mkdtempSync(join(tmpdir(), "auth-schema-"));
  mkdirSync(join(root, "migrations/auth"), { recursive: true });
  for (const name of ["0001_auth.sql", "0002_wolfpit_rate_limit.sql"]) {
    writeFileSync(join(root, "migrations/auth", name), "create table t ();\n");
    assert.equal(authSchemaCopy(root, name), null);

    writeFileSync(join(root, "migrations", name), "create table t ();\n");
    const same = authSchemaCopy(root, name);
    assert.equal(same.copy, same.source);

    writeFileSync(join(root, "migrations", name), "create table t (x int);\n");
    const drifted = authSchemaCopy(root, name);
    assert.notEqual(drifted.copy, drifted.source);
  }
});
