import { createContext, useContext } from "react";
import { MODE_CHAIN, MODE_COPY, modeStatuses, type Mode, type ModeStatus } from "./mode-config";

/**
 * The mode CONTEXT and HOOK live here, not in `mode.tsx`.
 * `react-refresh/only-export-components`: a module that exports both a
 * component (`ModeProvider`) and a hook breaks fast-refresh boundaries, and
 * silencing that rule would mask future mistakes for every module. This file
 * has no component, `mode.tsx` has only the provider, and the rule is silent
 * for the right reason.
 */

export type ModeCtx = {
  mode: Mode;
  setMode: (m: Mode) => void;
  /** Every mode, with whether this deployment can serve it. */
  statuses: ModeStatus[];
  available: Mode[];
  chain: (typeof MODE_CHAIN)[Mode];
  copy: (typeof MODE_COPY)[Mode];
};

export const ModeContext = createContext<ModeCtx | null>(null);

/** Read the app-wide mode. Safe outside the provider (returns sim). */
export function useMode(): ModeCtx {
  const ctx = useContext(ModeContext);
  return (
    ctx ?? {
      mode: "sim",
      setMode: () => {},
      statuses: modeStatuses({}),
      available: ["sim"],
      chain: MODE_CHAIN.sim,
      copy: MODE_COPY.sim,
    }
  );
}
