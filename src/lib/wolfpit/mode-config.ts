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

/** A mode plus whether this deployment can actually serve it. */
export type ModeStatus = { mode: Mode; ready: boolean; reason?: string };

const isAddr = (v?: string) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v.trim());

/**
 * Status of EVERY mode. All three are always listed: the toggle shows the
 * whole map and marks which stops are open, instead of hiding the closed ones.
 *
 * Hiding them is how this shipped invisible — with no Sepolia contracts
 * configured the list collapsed to one entry and the toggle rendered nothing
 * on every page.
 *
 * - `sim` is always ready; it is the paper engine and needs nothing.
 * - `live` is always ready. Spot swaps run through the aggregator behind the
 *   `spotQuote` server fn and have never needed a vault address. Gating it on
 *   VITE_VAULT was simply wrong: it disabled a path that works today.
 * - `testnet` needs the contracts from `DeploySepolia.s.sol`. Until
 *   VITE_VAULT_SEPOLIA is set it is shown but not selectable, with the reason
 *   stated — a visible "not yet" beats a tab that silently does nothing.
 */
export function modeStatuses(env: { testnetVault?: string }): ModeStatus[] {
  return MODES.map((mode) => {
    if (mode === "testnet" && !isAddr(env.testnetVault)) {
      return { mode, ready: false, reason: "Base Sepolia contracts are not deployed yet." };
    }
    return { mode, ready: true };
  });
}

/** Modes a user may actually switch into. */
export function availableModes(env: { testnetVault?: string }): Mode[] {
  return modeStatuses(env)
    .filter((s) => s.ready)
    .map((s) => s.mode);
}
