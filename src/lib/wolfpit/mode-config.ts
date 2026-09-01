/**
 * App-wide trading mode: paper sim, Base Sepolia testnet, or Base mainnet.
 *
 * Previously the sim/live switch lived inside `/trade` only — a per-route
 * `useState` plus its own localStorage key — so the rest of the app had no
 * idea which mode the user was in. This provider owns it once and every route
 * reads the same value.
 *
 * REMOVING TESTNET AFTER LAUNCH: delete "testnet" from `MODES` below. The
 * union type narrows, the tab disappears, and every branch that still assumes
 * a testnet fails to typecheck instead of quietly lingering in the bundle.
 */
export const MODES = ["sim", "testnet", "live"] as const;
export type Mode = (typeof MODES)[number];

/** Chain each mode trades on. `sim` touches no chain at all. */
export const MODE_CHAIN: Record<Mode, { chainId: number | null; name: string }> = {
  sim: { chainId: null, name: "Paper" },
  testnet: { chainId: 84532, name: "Base Sepolia" },
  live: { chainId: 8453, name: "Base" },
};

/**
 * What the user is told. These strings are load-bearing: a mode that trades
 * test tokens must never be described as anything else.
 */
export const MODE_COPY: Record<Mode, { tab: string; banner: string; tone: "muted" | "warn" | "brass" }> = {
  sim: { tab: "Sim", banner: "Paper · $100k play money · no chain", tone: "muted" },
  testnet: { tab: "Testnet", banner: "Base Sepolia · test tokens · no real value", tone: "brass" },
  live: { tab: "Live", banner: "Base mainnet · real funds · non-custodial", tone: "warn" },
};

export const MODE_KEY = "wolfpit.trade-mode";

/** Coerce anything (URL param, localStorage, env) to a real mode. */
export function normalizeMode(raw: unknown): Mode | undefined {
  return MODES.find((m) => m === raw);
}

/**
 * Which modes this deployment offers. A mode whose contracts are not
 * configured is NOT shown: a tab that cannot work is worse than no tab.
 * `sim` is always available.
 */
export function availableModes(env: {
  testnetVault?: string;
  liveVault?: string;
}): Mode[] {
  const isAddr = (v?: string) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v.trim());
  return MODES.filter((m) => {
    if (m === "sim") return true;
    if (m === "testnet") return isAddr(env.testnetVault);
    return isAddr(env.liveVault);
  });
}
