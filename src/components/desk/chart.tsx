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
  if (interval === "1h") return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function pxLabel(p: number) {
  if (p >= 1000) return p.toFixed(0);
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
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
      const h = Math.max(1, parent.clientHeight || height);
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = "100%";
      canvas.style.height = "100%";
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
      const slice = candles.length > 120 ? candles.slice(-120) : candles;
      if (slice.length < 2) {
        ctx.fillStyle = muted;
        ctx.font = "12px 'IBM Plex Sans', sans-serif";
        ctx.fillText("Waiting on candles…", 16, h / 2);
        return;
      }
      const padL = 8;
      const padR = 54;
      const padT = 8;
      const padB = 22;
      let lo = Math.min(...slice.map((c) => c.l));
      let hi = Math.max(...slice.map((c) => c.h));
      if (!(hi > lo)) {
        lo *= 0.98;
        hi *= 1.02;
      }
      const pad = (hi - lo) * 0.06 || hi * 0.02;
      lo = Math.max(0, lo - pad);
      hi += pad;
      const plotW = Math.max(1, w - padL - padR);
      const plotH = Math.max(1, h - padT - padB);
      const gap = plotW / slice.length;
      const cw = Math.min(7, Math.max(1.25, gap * 0.62));
      const x = (i: number) => padL + gap * i + gap / 2;
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
        ctx.fillText(pxLabel(p), w - padR + 6, yy + 3);
      }
      const ticks = 3;
      for (let i = 0; i <= ticks; i++) {
        const idx = Math.round((i / ticks) * (slice.length - 1));
        const bar = slice[idx];
        if (!bar) continue;
        ctx.fillText(axisLabel(bar.t, interval), Math.min(x(idx), w - padR - 56), h - 6);
      }
      slice.forEach((c, i) => {
        const isUp = c.c >= c.o;
        ctx.strokeStyle = isUp ? up : down;
        ctx.fillStyle = isUp ? up : down;
        ctx.lineWidth = 1;
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
  compact = 148,
}: {
  candles: Candle[];
  interval: ChartInterval;
  status?: "ok" | "load" | "empty";
  onInterval?: (iv: ChartInterval) => void;
  compact?: number;
}) {
  return (
    <div className="overflow-hidden bg-chart">
      <div className="flex items-center gap-1 px-2">
        {onInterval
          ? (["1m", "5m", "15m", "1h", "1d"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onInterval(k)}
                className={`pressable h-8 px-2 font-mono text-[11px] ${interval === k ? "text-brass" : "text-muted"}`}
              >
                {k}
              </button>
            ))
          : null}
      </div>
      <div style={{ height: compact }}>
        {status === "load" ? (
          <p className="p-3 text-sm text-muted">Loading candles…</p>
        ) : (
          <PitChart candles={candles} height={compact} interval={interval} />
        )}
      </div>
    </div>
  );
}