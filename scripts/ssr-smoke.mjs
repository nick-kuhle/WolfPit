#!/usr/bin/env node
/**
 * SSR smoke test: boot the bundle Vercel actually runs and fetch real routes.
 *
 * WHY THIS EXISTS. On 2026-08-31 a commit passed `tsc --noEmit`, `eslint`,
 * 261 unit tests and `npm run build` — and took every route to HTTP 500 in
 * production. A `createServerFn` had landed in the root bundle chunk, so the
 * SSR entry threw `createSsrRpc is not a function` on import. Nothing in the
 * PR bar imported the built server bundle, so nothing noticed.
 *
 * A build that compiles is not a build that boots. This runs after
 * `npm run build` and asserts the server can actually serve.
 *
 * Usage: npm run build && npm run test:ssr
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ENTRY = resolve(process.cwd(), ".vercel/output/functions/__server.func/index.mjs");

/** Routes that must respond. 3xx counts: /admin redirects to /admin/login. */
const ROUTES = [
  { path: "/", expect: [200] },
  { path: "/trade", expect: [200] },
  { path: "/admin", expect: [200, 301, 302, 307, 308] },
  { path: "/admin/login", expect: [200] },
];

const ORIGIN = "https://wolfpit-protocol.vercel.app";

async function main() {
  if (!existsSync(ENTRY)) {
    console.error(`[ssr-smoke] no build found at ${ENTRY}\n[ssr-smoke] run \`npm run build\` first.`);
    process.exit(1);
  }

  let handler;
  try {
    const mod = await import(pathToFileURL(ENTRY).href);
    handler = mod.default;
  } catch (e) {
    // An import-time throw is the exact failure this script was written for.
    console.error("[ssr-smoke] FAIL — the server bundle threw while being imported.");
    console.error(e?.stack ?? e);
    process.exit(1);
  }

  if (typeof handler?.fetch !== "function") {
    console.error("[ssr-smoke] FAIL — the bundle did not export a fetch handler.");
    process.exit(1);
  }

  let failed = 0;
  for (const route of ROUTES) {
    const url = `${ORIGIN}${route.path}`;
    let status = 0;
    let detail = "";
    try {
      const res = await handler.fetch(new Request(url, { headers: { accept: "text/html" } }), {
        waitUntil() {},
      });
      status = res.status;
      if (!route.expect.includes(status)) detail = (await res.text()).slice(0, 300);
    } catch (e) {
      detail = e?.stack ?? String(e);
    }
    const ok = route.expect.includes(status);
    console.log(`[ssr-smoke] ${ok ? "ok  " : "FAIL"} ${route.path} -> ${status || "threw"}`);
    if (!ok) {
      failed++;
      if (detail) console.error(detail);
    }
  }

  if (failed) {
    console.error(`[ssr-smoke] ${failed} route(s) failed. Do not deploy this.`);
    process.exit(1);
  }
  console.log(`[ssr-smoke] all ${ROUTES.length} routes served.`);
  process.exit(0);
}

await main();
