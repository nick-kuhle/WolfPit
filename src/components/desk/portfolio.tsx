import { futPnl, lpValue, optMark, tokenPx } from "@/lib/wolfpit/engine";
import { ping } from "@/lib/wolfpit/alerts";
import { useDesk, type Listing } from "@/lib/wolfpit/desk";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPx, fmtUsd } from "@/lib/utils";

export function Portfolio({ onPick }: { onPick?: (l: Listing) => void }) {
  const s = useWolf();
  const closeFut = useWolf((st) => st.closeFut);
  const closeOpt = useWolf((st) => st.closeOpt);
  const universe = useDesk((d) => d.universe);
  const setFocus = useDesk((d) => d.setFocus);
  const listToken = useWolf((st) => st.listToken);

  const holdings: { sym: string; qty: number; px: number }[] = [
    { sym: "USDC", qty: s.account.usdc, px: 1 },
    { sym: "ETH", qty: s.account.eth, px: s.eth },
    { sym: "WPIT", qty: s.account.wpit, px: s.wpit },
    ...Object.entries(s.account.tokens ?? {}).map(([sym, qty]) => {
      const live = universe.find((u) => u.symbol === sym);
      return { sym, qty, px: live?.price || tokenPx(s, sym) };
    }),
  ].filter((h) => h.qty > 1e-8);

  const total = holdings.reduce((a, h) => a + h.qty * h.px, 0);

  function openSym(sym: string) {
    const live = universe.find((u) => u.symbol === sym);
    const l: Listing = live ?? {
      symbol: sym,
      name: sym,
      price: holdings.find((h) => h.sym === sym)?.px ?? 0,
      change24: 0,
      volume24: 0,
    };
    setFocus(l);
    listToken(sym, l.price || 1);
    ping(`${sym} from wallet`, "brass");
    onPick?.(l);
  }

  return (
    <div className="min-h-0 overflow-auto p-3">
      <h3 className="mb-2 text-[10px] uppercase tracking-wider text-subtle">Wallet · paper</h3>
      {holdings.map((h) => (
        <button
          key={h.sym}
          onClick={() => openSym(h.sym)}
          className="flex w-full items-center justify-between border-b border-border py-2 text-left text-xs"
        >
          <span>
            {h.sym}
            <span className="ml-2 font-mono text-muted">{h.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
          </span>
          <span className="font-mono tabular-nums">
            {fmtUsd(h.qty * h.px)}
            <span className="ml-2 text-subtle">{total > 0 ? `${((h.qty * h.px) / total) * 100 | 0}%` : ""}</span>
          </span>
        </button>
      ))}
      <div className="mt-2 flex justify-between text-xs">
        <span className="text-muted">Spot value</span>
        <span className="font-mono">{fmtUsd(total)}</span>
      </div>

      <h3 className="mb-2 mt-5 text-[10px] uppercase tracking-wider text-subtle">LP</h3>
      {s.lp.length === 0 ? <p className="text-xs text-muted">No LP shares.</p> : null}
      {s.lp.map((p) => (
        <div key={p.poolId} className="flex justify-between border-b border-border py-1.5 text-xs">
          <span>{p.poolId}</span>
          <span className="font-mono">{fmtUsd(lpValue(s, p.poolId, p.shares))}</span>
        </div>
      ))}

      <h3 className="mb-2 mt-5 text-[10px] uppercase tracking-wider text-subtle">Minis</h3>
      {s.futures.length === 0 && s.options.length === 0 ? (
        <p className="text-xs text-muted">No open derivatives. Trade from the ticket.</p>
      ) : null}
      {s.futures.map((p) => {
        const pnl = futPnl(p, s.eth);
        return (
          <div key={p.id} className="mb-2 flex items-center justify-between border-b border-border pb-2 text-xs">
            <div>
              <div className="font-medium">
                {p.side.toUpperCase()} {p.sizeEth} ETH
              </div>
              <div className="font-mono text-muted">
                {fmtPx(p.entry)} → {fmtPx(s.eth)}
              </div>
            </div>
            <div className="text-right">
              <div className={`font-mono ${pnl >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(pnl)}</div>
              <button
                className="h-10 text-muted"
                onClick={() => {
                  ping("Closing future", "brass");
                  closeFut(p.id);
                }}
              >
                Close
              </button>
            </div>
          </div>
        );
      })}
      {s.options.map((p) => {
        const m = optMark(s, p) * p.sizeEth;
        const pnl = m - p.premium * p.sizeEth;
        return (
          <div key={p.id} className="mb-2 flex items-center justify-between border-b border-border pb-2 text-xs">
            <div>
              <div className="font-medium">
                LONG {p.sizeEth} {p.strike} {p.type}
              </div>
            </div>
            <div className="text-right">
              <div className={`font-mono ${pnl >= 0 ? "text-up" : "text-down"}`}>{fmtUsd(pnl)}</div>
              <button
                className="h-10 text-muted"
                onClick={() => {
                  ping("Closing option", "brass");
                  closeOpt(p.id);
                }}
              >
                Close
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
