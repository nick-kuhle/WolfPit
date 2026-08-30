// F4: chain adapter. "Base live" is a CLAIM, not a label: it renders only when
// a real deployment is wired (VITE_CHAIN=base|base-sepolia AND VITE_VAULT is a
// valid 0x address). Everything else is paper/sim, and the UI says so. The
// deploy contract lives in env.example + docs/DEV.md.
export type ChainMode = "sim" | "base-sepolia" | "base";

export type ChainState = {
  mode: ChainMode;
  /** True when a real chain adapter is wired (vault address present). */
  live: boolean;
  vault?: string;
  wpit?: string;
  poolEthUsdc?: string;
  poolWpitUsdc?: string;
  poolWpitEth?: string;
  farm?: string;
  stake?: string;
  label: string;
};

type ViteEnv = { env?: Record<string, string | undefined> };

function envVar(key: string): string | undefined {
  try {
    const v = (import.meta as ViteEnv).env?.[key];
    return v && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined; // SSR / non-Vite context
  }
}

export function chainMode(raw?: string): ChainMode {
  const v = ((raw ?? envVar("VITE_CHAIN")) || "sim").toLowerCase();
  if (v === "base") return "base";
  if (v === "base-sepolia" || v === "sepolia") return "base-sepolia";
  return "sim";
}

export function isEvmAddress(v?: string): boolean {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

/** Full chain state; `live` gates every "Base live" rendering in the UI. */
export function chainState(raw?: string): ChainState {
  const mode = chainMode(raw);
  const vault = envVar("VITE_VAULT");
  const wpit = envVar("VITE_WPIT");
  const poolEthUsdc = envVar("VITE_POOL_ETH_USDC");
  const poolWpitUsdc = envVar("VITE_POOL_WPIT_USDC");
  const poolWpitEth = envVar("VITE_POOL_WPIT_ETH");
  const farm = envVar("VITE_FARM");
  const stake = envVar("VITE_STAKE");
  const live = mode !== "sim" && isEvmAddress(vault);
  const label = live ? (mode === "base" ? "Base live" : "Base Sepolia") : "Base · paper";
  return { mode, live, vault, wpit, poolEthUsdc, poolWpitUsdc, poolWpitEth, farm, stake, label };
}

export function chainLabel(raw?: string) {
  return chainState(raw).label;
}
