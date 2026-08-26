import { createFileRoute } from "@tanstack/react-router";
import { Positions } from "@/components/desk/positions";
import { ProductGate } from "@/components/product-gate";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/book")({ component: BookPage });

function BookPage() {
  return (
    <Shell desk>
      <ProductGate product="desk">
        <div className="h-[calc(100dvh-3rem)] min-h-0">
          <Positions flush />
        </div>
      </ProductGate>
    </Shell>
  );
}
