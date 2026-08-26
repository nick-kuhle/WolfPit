import { createFileRoute } from "@tanstack/react-router";
import { Desk } from "@/components/desk/desk";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/trade")({ component: TradePage });

function TradePage() {
  return (
    <Shell desk>
      <ProductGate product="desk">
        <div className="h-full min-h-0">
          <Desk pane="trade" />
        </div>
      </ProductGate>
    </Shell>
  );
}