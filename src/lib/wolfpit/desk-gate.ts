import { createServerFn } from "@tanstack/react-start";

/**
 * Desk gate (WP-07 / #13, extended beyond spot).
 *
 * 2026-08-31: `checkTradingAllowed` was wired to exactly ONE caller,
 * `spotQuote`. The futures, options and race desks accept orders entirely in
 * the browser (`src/lib/wolfpit/store.ts` -> `engine.ts`), so an operator who
 * paused the book stopped spot and nothing else. The pause switch was telling
 * the truth about one desk and lying about three.
 *
 * Every desk now asks the server before it will accept an order. The paper
 * desks are play money, but the rule is the rule: a halt means a halt, and the
 * same code path carries the geo-fence, which is a compliance boundary rather
 * than a convenience. When these desks move on-chain the gate is already in
 * front of them.
 *
 * The client cannot be trusted with this decision — that is the whole point —
 * so `deskOpen` reads server state on every call and the caller must treat a
 * failure as "no order".
 */
export type DeskProduct = "spot" | "future" | "option" | "race";

/** Products that exist. Adding one here forces it through the gate. */
export const DESK_PRODUCTS: readonly DeskProduct[] = ["spot", "future", "option", "race"] as const;

export type DeskGateResult =
  | { ok: true }
  | { ok: false; code: "paused" | "geo" | "policy-unavailable"; error: string };

/**
 * Coerce caller input to a known product. An unknown value is gated as the
 * STRICTEST thing we have rather than waved through: a typo in a caller must
 * never become an ungated desk.
 */
export function normalizeProduct(raw: unknown): DeskProduct {
  return DESK_PRODUCTS.find((x) => x === raw) ?? "option";
}

/** Per-IP ceiling on gate checks (audit N-2): same cadence as the 0x proxy. */
const DESK_GATE_MAX_PER_MIN = 120;

export const deskOpen = createServerFn({ method: "GET" })
  .validator((d: { product?: string }): { product: DeskProduct } => ({
    product: normalizeProduct(d?.product),
  }))
  .handler(async ({ data }): Promise<DeskGateResult> => {
    // The gate service-queries the policy store on EVERY order click, on every
    // desk. Unthrottled, a single caller turns that into free DB load (a GET
    // needs no body, no session). Same fail-open quota limiter as the swap
    // proxy: a store hiccup must not freeze the desks, and the cost of a
    // missed throttle is DB load, not a compliance breach — the gate's own
    // fail-closed policy check still runs whenever the counter store is down.
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { clientIp, bumpLimit } = await import("../auth/rate-limit.server");
      const ip = clientIp(getRequest());
      if (await bumpLimit("deskg", ip ?? "unknown", DESK_GATE_MAX_PER_MIN, 60)) {
        return {
          ok: false,
          code: "policy-unavailable",
          error: "Too many desk checks from this address. Wait a moment and retry.",
        };
      }
    } catch {
      /* fail-open on store/request errors — the policy check below decides */
    }
    const { checkTradingAllowed } = await import("@/lib/admin/policy.server");
    return checkTradingAllowed({ products: [data.product] });
  });
