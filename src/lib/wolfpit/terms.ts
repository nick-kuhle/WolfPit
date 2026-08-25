import { create } from "zustand";
import { persist } from "zustand/middleware";

export const TERMS_VERSION = "2026-08-25";

type TermsState = {
  version: string | null;
  acceptedAt: number | null;
  accepted: boolean;
  rehydrate: () => void;
  accept: () => void;
  revoke: () => void;
};

export const useTerms = create<TermsState>()(
  persist(
    (set) => ({
      version: null,
      acceptedAt: null,
      accepted: false,
      rehydrate: () => {
        void useTerms.persist.rehydrate();
      },
      accept: () => set({ accepted: true, version: TERMS_VERSION, acceptedAt: Date.now() }),
      revoke: () => set({ accepted: false, version: null, acceptedAt: null }),
    }),
    { name: "wolfpit-terms-v1", skipHydration: true },
  ),
);

export function termsOk() {
  const s = useTerms.getState();
  return s.accepted && s.version === TERMS_VERSION;
}
