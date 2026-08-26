import { useEffect } from "react";
import { useWallet } from "@/lib/wallet/session";

export function WalletHydrate() {
  const hydrate = useWallet((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return null;
}
