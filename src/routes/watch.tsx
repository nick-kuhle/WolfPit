import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Watchlist } from "@/components/desk/watchlist";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";
import { useDesk, type Listing } from "@/lib/wolfpit/desk";
import { useWolf } from "@/lib/wolfpit/store";

export const Route = createFileRoute("/watch")({ component: WatchPage });

function WatchPage() {
  const nav = useNavigate();
  function pick(l: Listing) {
    useDesk.getState().setFocus(l);
    useWolf.getState().listToken(l.symbol, l.price || 1);
    void nav({ to: "/asset/$symbol", params: { symbol: l.symbol } });
  }
  return (
    <Shell desk>
      <ProductGate product="desk">
        <div className="h-[calc(100dvh-3rem)] min-h-0">
          <Watchlist onPick={pick} />
        </div>
      </ProductGate>
    </Shell>
  );
}
