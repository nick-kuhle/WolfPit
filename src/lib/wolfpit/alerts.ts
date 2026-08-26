import { create } from "zustand";

export type AlertTone = "up" | "down" | "brass";

export type PitAlert = {
  id: string;
  msg: string;
  tone: AlertTone;
  t: number;
  burst?: boolean;
};

type Alerts = {
  items: PitAlert[];
  push: (msg: string, tone?: AlertTone, burst?: boolean) => void;
  dismiss: (id: string) => void;
};

let n = 0;

export const useAlerts = create<Alerts>((set, get) => ({
  items: [],
  push: (msg, tone = "brass", burst = false) => {
    const id = `a${++n}`;
    set({ items: [{ id, msg, tone, t: Date.now(), burst }, ...get().items].slice(0, 6) });
    if (typeof window !== "undefined") {
      window.setTimeout(() => get().dismiss(id), burst ? 5600 : 4200);
    }
  },
  dismiss: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
}));

export function ping(msg: string, tone: AlertTone = "brass", burst = false) {
  useAlerts.getState().push(msg, tone, burst);
}
