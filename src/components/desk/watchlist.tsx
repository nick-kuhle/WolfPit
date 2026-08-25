import { bookGreeks, freeEth, freeUsdc, maxNetLongEth, maxNetShortEth, utilEth } from "@/lib/wolfpit/engine";
import { circuitActive, haltShortGamma, insuranceRatio } from "@/lib/wolfpit/risk";
import { useWolf } from "@/lib/wolfpit/store";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/utils";

export function Watchlist() {
  const s = useWolf();
  const g = bookGreeks(s);
  const ethPool = s.pools["ETH-USDC"];
  const wUsd = s.pools["WPIT-USDC-TEST"];
  const wEth = s.pools["WPIT-ETH-TEST"];
  const rows = [
    { s: "ETH-USD", px: s.eth, ch: ch(s.candles) },
    { s: "BTC-USD", px: s.btc || 0, ch: 0 },
    { s: "WPIT-USD", px: s.wpit, ch: ch(s.wpitCandles) },
    { s: "ETH-USDC pool", px: ethPool.quoteReserve / ethPool.baseReserve, ch: 0 },
    { s: "WPIT-USDC-TEST", px: wUsd.quoteReserve / wUsd.baseReserve, ch: 0 },
    { s: "WPIT-ETH-TEST", px: (wEth.quoteReserve / wEth.baseReserve) * s.eth, ch: 0 },
  ];
  const circ = circuitActive(s);
  const halt = haltShortGamma(s);
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-subtle">
        Markets · {s.liveSource || "feed"}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.map((r) => (
          <div key={r.s} className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="text-xs text-fg">{r.s}</div>
            <div className="text-right">
              <div className="font-mono text-xs tabular-nums">{fmtPx(r.px)}</div>
              <div className={`font-mono text-[10px] tabular-nums ${r.ch >= 0 ? "text-up" : "text-down"}`}>{fmtPct(r.ch)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-subtle">Risk / hedge</div>
        <p className="mb-2 text-[11px] leading-snug text-muted">Covered. α=40%. 4× IM. Never naked.</p>
        {circ ? <p className="mb-2 text-[11px] text-down">Circuit: new shorts halted.</p> : null}
        {halt && !circ ? <p className="mb-2 text-[11px] text-down">Short gamma halted (insurance).</p> : null}
        <Stat k="ETH free / total" v={`${freeEth(s).toFixed(2)} / ${s.vault.eth.toFixed(2)}`} />
        <Stat k="USDC free" v={fmtUsd(freeUsdc(s))} />
        <Stat k="Util" v={`${(utilEth(s) * 100).toFixed(0)}% / 40%`} />
        <Stat k="Max net long" v={`${maxNetLongEth(s).toFixed(2)} ETH`} />
        <Stat k="Max net short" v={`${maxNetShortEth(s).toFixed(2)} ETH`} />
        <Stat k="Book Δ" v={`${g.delta >= 0 ? "+" : ""}${g.delta.toFixed(3)} ETH`} />
        <Stat k="Book Γ" v={g.gamma.toFixed(4)} />
        <Stat k="IV / RV" v={`${(s.iv * 100).toFixed(0)}% / ${(s.realizedVol * 100).toFixed(0)}%`} />
        <Stat k="Insurance" v={fmtUsd(s.insuranceUsdc ?? 0)} />
        <Stat k="Ins / NAV" v={`${(insuranceRatio(s) * 100).toFixed(2)}%`} />
        <Stat k="Spot fee" v={`${ethPool.feeBps} bps`} />
      </div>
    </div>
  );
}

function ch(candles: { c: number }[]) {
  if (candles.length < 30) return 0;
  const a = candles[candles.length - 30]!.c;
  const b = candles[candles.length - 1]!.c;
  return (b - a) / a;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-0.5 text-[11px]">
      <span className="text-muted">{k}</span>
      <span className="font-mono tabular-nums">{v}</span>
    </div>
  );
}
