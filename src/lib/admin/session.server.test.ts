import test from "node:test";
import assert from "node:assert/strict";

/*
 * 2026-08-31 — "the admin panel won't sign me in, and there's no error."
 *
 * Cause: in production `adminCredentials()` and `secret()` THREW when
 * ADMIN_USER / ADMIN_PASS / ADMIN_SESSION_SECRET were unset, and the sign-in
 * form called `adminLogin()` with no `.catch`. The promise rejected, `.then`
 * never ran, and the page did nothing at all — indistinguishable, from the
 * operator's seat, from a wrong password.
 *
 * The rule these tests hold: a MISCONFIGURATION must be reportable without
 * throwing. Fail closed, but always say why.
 */

/** Import a fresh copy so module-level state cannot leak between cases. */
let n = 0;
async function freshSession(env: Record<string, string | undefined>) {
  const prev = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import(`./session.server.ts?case=${(n += 1)}`);
  return { mod, restore: () => (process.env = prev) };
}

const PROD_UNSET = {
  NODE_ENV: "production",
  ADMIN_USER: undefined,
  ADMIN_PASS: undefined,
  ADMIN_SESSION_SECRET: undefined,
};

test("unconfigured production names every missing variable", async () => {
  const { mod, restore } = await freshSession(PROD_UNSET);
  try {
    const s = mod.adminAuthStatus();
    assert.equal(s.ok, false);
    if (!s.ok) {
      // The operator must be able to act on this without reading the source.
      assert.match(s.error, /not configured/i);
      assert.match(s.error, /ADMIN_USER/);
      assert.match(s.error, /ADMIN_PASS/);
      assert.match(s.error, /ADMIN_SESSION_SECRET/);
    }
  } finally {
    restore();
  }
});

test("status is a question, not a throw", async () => {
  const { mod, restore } = await freshSession(PROD_UNSET);
  try {
    // The whole point: this call must not reject. `verifyPassword` still may.
    assert.doesNotThrow(() => mod.adminAuthStatus());
  } finally {
    restore();
  }
});

test("a configured deployment verifies credentials normally", async () => {
  const { mod, restore } = await freshSession({
    NODE_ENV: "production",
    ADMIN_USER: "ops",
    ADMIN_PASS: "correct horse battery staple",
    ADMIN_SESSION_SECRET: "x".repeat(64),
  });
  try {
    assert.equal(mod.adminAuthStatus().ok, true);
    assert.equal(mod.verifyPassword("ops", "correct horse battery staple"), true);
    assert.equal(mod.verifyPassword("ops", "wrong"), false);
    assert.equal(mod.verifyPassword("someone-else", "correct horse battery staple"), false);
  } finally {
    restore();
  }
});

test("a weak or defaulted session secret is rejected by name", async () => {
  for (const [secret, why] of [
    ["tooshort", "under 32 chars"],
    ["wolfpit-dev-admin-secret-not-for-prod", "the shipped dev default"],
  ] as const) {
    const { mod, restore } = await freshSession({
      NODE_ENV: "production",
      ADMIN_USER: "ops",
      ADMIN_PASS: "pw",
      ADMIN_SESSION_SECRET: secret,
    });
    try {
      const s = mod.adminAuthStatus();
      assert.equal(s.ok, false, `${why} must not pass`);
      if (!s.ok) assert.match(s.error, /ADMIN_SESSION_SECRET/);
    } finally {
      restore();
    }
  }
});

test("a token minted under a live secret round-trips", async () => {
  const { mod, restore } = await freshSession({
    NODE_ENV: "production",
    ADMIN_USER: "ops",
    ADMIN_PASS: "pw",
    ADMIN_SESSION_SECRET: "y".repeat(64),
  });
  try {
    const token = mod.mintAdminToken("ops");
    assert.equal(mod.verifyAdminToken(token), "ops");
    // Tampering with the user half invalidates the signature.
    const [, exp, sig] = token.split(".");
    assert.equal(mod.verifyAdminToken(`root.${exp}.${sig}`), null);
    assert.equal(mod.verifyAdminToken("garbage"), null);
    assert.equal(mod.verifyAdminToken(""), null);
    assert.equal(mod.verifyAdminToken(null), null);
  } finally {
    restore();
  }
});

test("an unverifiable cookie is 'no session', NOT an exception", async () => {
  // The bug shape: with no signing secret in production, verification used to
  // throw, so /admin rejected instead of simply showing the sign-in page.
  const minted = await freshSession({
    NODE_ENV: "production",
    ADMIN_USER: "ops",
    ADMIN_PASS: "pw",
    ADMIN_SESSION_SECRET: "z".repeat(64),
  });
  const token = minted.mod.mintAdminToken("ops");
  minted.restore();

  const { mod, restore } = await freshSession(PROD_UNSET);
  try {
    let out: string | null = "unset";
    assert.doesNotThrow(() => {
      out = mod.verifyAdminToken(token);
    }, "a missing secret must not throw at the caller");
    assert.equal(out, null, "and the session must not be honoured either");
  } finally {
    restore();
  }
});

test("an expired token is refused even when it is validly signed", async () => {
  const { mod, restore } = await freshSession({
    NODE_ENV: "production",
    ADMIN_USER: "ops",
    ADMIN_PASS: "pw",
    ADMIN_SESSION_SECRET: "q".repeat(64),
  });
  try {
    const token = mod.mintAdminToken("ops");
    const [user, , sig] = token.split(".");
    assert.equal(mod.verifyAdminToken(`${user}.${Date.now() - 1000}.${sig}`), null);
  } finally {
    restore();
  }
});
