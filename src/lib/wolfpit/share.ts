import { ping } from "@/lib/wolfpit/alerts";
import type { Listing } from "@/lib/wolfpit/desk";

export function assetPath(l: Pick<Listing, "symbol" | "name" | "chain" | "contract" | "network">) {
  const p = new URLSearchParams();
  if (l.name) p.set("name", l.name);
  if (l.chain) p.set("chain", l.chain);
  if (l.contract) p.set("contract", l.contract);
  if (l.network) p.set("network", l.network);
  const q = p.toString();
  return `/asset/${encodeURIComponent(l.symbol.toUpperCase())}${q ? `?${q}` : ""}`;
}

export async function shareAsset(l: Listing) {
  const url = `${window.location.origin}${assetPath(l)}`;
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: `${l.symbol} on WolfPit`, text: l.name, url });
      return "shared" as const;
    } catch {
      /* dismissed */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    ping("Link copied", "brass");
    return "copied" as const;
  } catch {
    ping(url, "brass");
    return "shown" as const;
  }
}
