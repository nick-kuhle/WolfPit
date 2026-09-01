import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  MODE_CHAIN,
  MODE_COPY,
  MODE_KEY,
  availableModes,
  normalizeMode,
  type Mode,
} from "./mode-config";

/**
 * React binding for the app-wide trading mode. The rules themselves live in
 * `mode-config.ts` so they can be imported (and tested) without React.
 */
type Ctx = {
  mode: Mode;
  setMode: (m: Mode) => void;
  available: Mode[];
  chain: (typeof MODE_CHAIN)[Mode];
  copy: (typeof MODE_COPY)[Mode];
};

const ModeContext = createContext<Ctx | null>(null);

function readEnv(key: string): string | undefined {
  try {
    const v = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
    return v && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const available = useMemo(
    () =>
      availableModes({
        testnetVault: readEnv("VITE_VAULT_SEPOLIA"),
        liveVault: readEnv("VITE_VAULT"),
      }),
    [],
  );

  // Start at sim on both server and client so hydration cannot mismatch; the
  // effect below upgrades to the URL/stored mode once mounted.
  const [mode, setModeState] = useState<Mode>("sim");

  useEffect(() => {
    let next: Mode | undefined;
    try {
      const url = new URLSearchParams(window.location.search).get("mode");
      next = normalizeMode(url) ?? normalizeMode(window.localStorage.getItem(MODE_KEY));
    } catch {
      /* no storage / no window search — sim stands */
    }
    // Never restore a mode this deployment cannot serve (e.g. a stored
    // "testnet" after the testnet is retired).
    if (next && available.includes(next)) setModeState(next);
  }, [available]);

  const setMode = useCallback(
    (m: Mode) => {
      if (!available.includes(m)) return;
      setModeState(m);
      try {
        window.localStorage.setItem(MODE_KEY, m);
        const url = new URL(window.location.href);
        url.searchParams.set("mode", m);
        window.history.replaceState({}, "", url);
      } catch {
        /* the in-memory mode still applies */
      }
    },
    [available],
  );

  const value = useMemo<Ctx>(
    () => ({ mode, setMode, available, chain: MODE_CHAIN[mode], copy: MODE_COPY[mode] }),
    [mode, setMode, available],
  );
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

/** Read the app-wide mode. Safe outside the provider (returns sim). */
export function useMode(): Ctx {
  const ctx = useContext(ModeContext);
  return (
    ctx ?? {
      mode: "sim",
      setMode: () => {},
      available: ["sim"],
      chain: MODE_CHAIN.sim,
      copy: MODE_COPY.sim,
    }
  );
}
