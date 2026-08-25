import { createFileRoute } from "@tanstack/react-router";
import { Desk } from "@/components/desk/desk";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/trade")({ component: TradePage });

function TradePage() {
  return (
    <Shell desk>
      <div className="h-[calc(100dvh-3rem-3.5rem)] min-h-0 lg:h-[calc(100dvh-3rem)]">
        <Desk />
      </div>
    </Shell>
  );
}
