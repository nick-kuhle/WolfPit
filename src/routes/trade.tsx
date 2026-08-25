import { createFileRoute } from "@tanstack/react-router";
import { Desk } from "@/components/desk/desk";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/trade")({ component: TradePage });

function TradePage() {
  return (
    <Shell desk>
      <div className="h-[calc(100dvh-3rem)] min-h-0">
        <Desk />
      </div>
    </Shell>
  );
}
