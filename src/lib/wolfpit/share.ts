import { ping } from "@/lib/wolfpit/alerts";
import type { Listing } from "@/lib/wolfpit/desk";

export function assetSearch(l: Pick<Listing, "name" | "chain" | "contract" | "network">) {
  const search: { name?: string; chain?: string; contract?: string; network?: string } = {};
  if (l.name) search.name = l.name;
  if (l.chain) search.chain = l.chain;
  if (l.contract) search.contract = l.contract;
  if (l.network) search.network = l.network;
  return search;
}

export function assetPath(l: Pick<Listing, "symbol" | "name" | "chain" | "contract" | "network">) {
  const p = new URLSearchParams();
  const s = assetSearch(l);
  if (s.name) p.set("name", s.name);
  if (s.chain) p.set("chain", s.chain);
  if (s.contract) p.set("contract", s.contract);
  if (s.network) p.set("network", s.network);
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
