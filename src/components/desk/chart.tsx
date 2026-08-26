import { useEffect, useRef } from "react";
import type { ChartInterval } from "@/lib/wolfpit/market";
import type { Candle } from "@/lib/wolfpit/types";

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function axisLabel(t: number, interval: ChartInterval) {
  const d = new Date(t);
  if (interval === "1d") return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (interval === "1h")
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function PitChart({
  candles,
  height = 240,
  interval = "1m",
}: {
  candles: Candle[];
  height?: number;
  interval?: ChartInterval;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, parent.clientWidth);
      const h = Math.max(1, height);
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = cssVar("--color-chart", "#101210");
      const grid = cssVar("--color-grid", "#262826");
      const muted = cssVar("--color-subtle", "#6b6b62");
      const up = cssVar("--color-up", "#3f9d6e");
      const down = cssVar("--color-down", "#c45c52");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      if (candles.length < 2) {
        ctx.fillStyle = muted;
        ctx.font = "12px 'IBM Plex Sans', sans-serif";
        ctx.fillText("Waiting on candles…", 16, h / 2);
        return;
      }
      const padL = 10;
      const padR = 52;
      const padT = 12;
      const padB = 28;
      const slice = candles.length > 240 ? candles.slice(-240) : candles;
      let lo = Math.min(...slice.map((c) => c.l));
      let hi = Math.max(...slice.map((c) => c.h));
      const pad = (hi - lo) * 0.08 || 1;
      lo -= pad;
      hi += pad;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const x = (i: number) => padL + (i / Math.max(slice.length - 1, 1)) * plotW;
      const y = (p: number) => padT + ((hi - p) / (hi - lo)) * plotH;
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = muted;
      for (let i = 0; i < 4; i++) {
        const p = lo + ((hi - lo) * i) / 3;
        const yy = y(p);
        ctx.beginPath();
        ctx.moveTo(padL, yy);
        ctx.lineTo(w - padR, yy);
        ctx.stroke();
        const label = p >= 1000 ? p.toFixed(0) : p >= 1 ? p.toFixed(2) : p.toFixed(5);
        ctx.fillText(label, w - padR + 6, yy + 3);
      }
      const ticks = 4;
      for (let i = 0; i <= ticks; i++) {
        const idx = Math.round((i / ticks) * (slice.length - 1));
        const bar = slice[idx];
        if (!bar) continue;
        const xx = x(idx);
        ctx.fillText(axisLabel(bar.t, interval), Math.min(xx, w - padR - 48), h - 8);
      }
      const cw = Math.max(1.5, plotW / slice.length - 1.2);
      slice.forEach((c, i) => {
        const isUp = c.c >= c.o;
        ctx.strokeStyle = isUp ? up : down;
        ctx.fillStyle = isUp ? up : down;
        const xc = x(i);
        ctx.beginPath();
        ctx.moveTo(xc, y(c.h));
        ctx.lineTo(xc, y(c.l));
        ctx.stroke();
        const top = y(Math.max(c.o, c.c));
        const bot = y(Math.min(c.o, c.c));
        ctx.fillRect(xc - cw / 2, top, cw, Math.max(1, bot - top));
      });
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [candles, height, interval]);

  return <canvas ref={ref} className="block h-full w-full" />;
}

export function ChartPane({
  candles,
  interval,
  status,
  onInterval,
  expanded,
  onToggle,
  compact = 148,
}: {
  candles: Candle[];
  interval: ChartInterval;
  status?: "ok" | "load" | "empty";
  onInterval?: (iv: ChartInterval) => void;
  expanded: boolean;
  onToggle: () => void;
  compact?: number;
}) {
  const h = expanded ? 420 : compact;
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-brass/30 bg-chart">
      <div className="flex items-center gap-1 border-b border-border px-2">
        {onInterval
          ? (["1m", "5m", "15m", "1h", "1d"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onInterval(k)}
                className={`pressable h-9 px-2 font-mono text-[11px] ${interval === k ? "text-fg" : "text-muted"}`}
              >
                {k}
              </button>
            ))
          : <span className="h-9 px-2 font-mono text-[11px] leading-9 text-subtle">equity</span>}
        <button type="button" className="pressable ml-auto h-9 px-2 font-mono text-[11px] text-brass" onClick={onToggle}>
          {expanded ? "Shrink" : "Expand"}
        </button>
      </div>
      <div style={{ height: h }}>
        {status && status !== "ok" ? (
          <p className="p-3 text-sm text-muted">{status === "load" ? "Loading candles…" : "No candles for this timeframe."}</p>
        ) : (
          <PitChart candles={candles} height={h} interval={interval} />
        )}
      </div>
    </div>
  );
}
