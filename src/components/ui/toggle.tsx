import { cn } from "@/lib/utils";

export function SideToggle({
  value,
  onChange,
  buyLabel = "Buy",
  sellLabel = "Sell",
}: {
  value: "buy" | "sell";
  onChange: (v: "buy" | "sell") => void;
  buyLabel?: string;
  sellLabel?: string;
}) {
  return (
    <div className="relative grid h-12 grid-cols-2 rounded-full border border-border bg-elevated p-1">
      <span
        className={cn(
          "pointer-events-none absolute inset-y-1 w-[calc(50%-4px)] rounded-full transition-transform duration-200 ease-out",
          value === "buy" ? "translate-x-0 bg-up" : "translate-x-full bg-down",
        )}
      />
      <button
        type="button"
        className={cn("relative z-10 text-sm font-medium", value === "buy" ? "text-bg" : "text-muted hover:text-fg")}
        onClick={() => onChange("buy")}
      >
        {buyLabel}
      </button>
      <button
        type="button"
        className={cn("relative z-10 text-sm font-medium", value === "sell" ? "text-fg" : "text-muted hover:text-fg")}
        onClick={() => onChange("sell")}
      >
        {sellLabel}
      </button>
    </div>
  );
}
