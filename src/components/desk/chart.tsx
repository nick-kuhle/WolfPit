import { useEffect, useRef, type ReactNode } from "react";
import type { ChartInterval } from "@/lib/wolfpit/market";
import type { Candle } from "@/lib/wolfpit/types";
import { cn, fmtPx } from "@/lib/utils";

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

type Win = { i0: number; i1: number };

function PitChart({
  candles,
  height = 240,
  interval = "1m",
}: {
  candles: Candle[];
  height?: number;
  interval?: ChartInterval;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const win = useRef<Win>({ i0: 0, i1: 0 });
  const lastN = useRef(0);
  const follow = useRef(true);
  const drag = useRef<{ x: number; i0: number; i1: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; i0: number; i1: number } | null>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const candlesRef = useRef(candles);
  candlesRef.current = candles;

  const firstT = candles[0]?.t;
  useEffect(() => {
    win.current = { i0: 0, i1: 0 };
    follow.current = true;
    lastN.current = 0;
  }, [firstT, interval]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const el = canvas;

    function clampWin(n: number, w: Win): Win {
      const span = Math.max(8, Math.min(n, w.i1 - w.i0));
      let i0 = w.i0;
      let i1 = i0 + span;
      if (i1 > n) {
        i1 = n;
        i0 = Math.max(0, n - span);
      }
      if (i0 < 0) i0 = 0;
      return { i0, i1: Math.max(i0 + 8, i1) };
    }

    function ensure() {
      const n = candlesRef.current.length;
      if (n < 2) return;
      if (win.current.i1 === 0 || lastN.current === 0) {
        const count = Math.min(90, n);
        win.current = { i0: n - count, i1: n };
        follow.current = true;
      } else if (follow.current && n !== lastN.current) {
        const span = win.current.i1 - win.current.i0;
        win.current = { i0: Math.max(0, n - span), i1: n };
      }
      lastN.current = n;
      win.current = clampWin(n, win.current);
    }

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
      const brass = cssVar("--color-brass", "#c4a35a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ensure();
      const all = candlesRef.current;
      const { i0, i1 } = win.current;
      const slice = all.slice(i0, i1);
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
      const cw = Math.min(9, Math.max(1.1, gap * 0.62));
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
      const hv = hover.current;
      if (hv && hv.x >= padL && hv.x <= w - padR) {
        const idx = Math.max(0, Math.min(slice.length - 1, Math.floor(((hv.x - padL) / plotW) * slice.length)));
        const c = slice[idx];
        if (c) {
          const xc = x(idx);
          ctx.strokeStyle = brass;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(xc, padT);
          ctx.lineTo(xc, padT + plotH);
          ctx.moveTo(padL, y(c.c));
          ctx.lineTo(w - padR, y(c.c));
          ctx.stroke();
          ctx.setLineDash([]);
          const label = `${axisLabel(c.t, interval)}  ${pxLabel(c.c)}`;
          ctx.fillStyle = "rgba(16,18,16,0.86)";
          ctx.fillRect(padL, padT, Math.min(plotW, 8 + label.length * 6.2), 18);
          ctx.fillStyle = brass;
          ctx.fillText(label, padL + 6, padT + 13);
        }
      }
    };

    function zoomAt(clientX: number, factor: number) {
      const n = candlesRef.current.length;
      if (n < 10) return;
      const rect = el.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      const { i0, i1 } = win.current;
      const span = i1 - i0;
      const next = Math.round(Math.max(8, Math.min(n, span * factor)));
      const center = i0 + span * frac;
      win.current = { i0: Math.round(center - next * frac), i1: Math.round(center - next * frac) + next };
      follow.current = win.current.i1 >= n - 1;
      win.current = clampWin(n, win.current);
      draw();
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      zoomAt(e.clientX, e.deltaY > 0 ? 1.14 : 0.86);
    }

    function onPointerDown(e: PointerEvent) {
      el.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        pinch.current = { dist: Math.max(1, dist), i0: win.current.i0, i1: win.current.i1 };
        drag.current = null;
      } else {
        drag.current = { x: e.clientX, i0: win.current.i0, i1: win.current.i1 };
      }
    }

    function onPointerMove(e: PointerEvent) {
      hover.current = { x: e.clientX - el.getBoundingClientRect().left, y: e.clientY };
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const n = candlesRef.current.length;
      if (pinch.current && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const factor = pinch.current.dist / Math.max(1, dist);
        const span = pinch.current.i1 - pinch.current.i0;
        const next = Math.round(Math.max(8, Math.min(n, span * factor)));
        const mid = (pinch.current.i0 + pinch.current.i1) / 2;
        win.current = { i0: Math.round(mid - next / 2), i1: Math.round(mid - next / 2) + next };
        follow.current = win.current.i1 >= n - 1;
        win.current = clampWin(n, win.current);
        draw();
        return;
      }
      if (drag.current) {
        const rect = el.getBoundingClientRect();
        const span = drag.current.i1 - drag.current.i0;
        const bars = ((drag.current.x - e.clientX) / Math.max(1, rect.width)) * span;
        const shift = Math.round(bars);
        win.current = { i0: drag.current.i0 + shift, i1: drag.current.i1 + shift };
        follow.current = win.current.i1 >= n - 1;
        win.current = clampWin(n, win.current);
        draw();
        return;
      }
      draw();
    }

    function onPointerUp(e: PointerEvent) {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      if (pointers.current.size === 0) drag.current = null;
    }

    function onDbl() {
      const n = candlesRef.current.length;
      const count = Math.min(90, n);
      win.current = { i0: Math.max(0, n - count), i1: n };
      follow.current = true;
      draw();
    }

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("pointerleave", () => {
      hover.current = null;
      draw();
    });
    el.addEventListener("dblclick", onDbl);
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("dblclick", onDbl);
    };
  }, [candles, height, interval]);

  return <canvas ref={ref} className="block h-full w-full cursor-crosshair touch-none" />;
}


function ChartPane({
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
        <span className="ml-auto font-mono text-[9px] uppercase tracking-wider text-subtle">pinch · drag · wheel</span>
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

/**
 * Framed chart card — the shared "beautiful" presentation used on both the live
 * swap page and the simulation trade page. Wraps ChartPane in a rounded panel
 * with a header (symbol / quote, headline price, change, name/tag). Callers pass
 * their own header pieces so the same card serves swap pairs and desk listings.
 */
export function ChartCard({
  symbol,
  quoteSymbol,
  name,
  price,
  changePct,
  tag,
  note,
  candles,
  interval,
  status,
  onInterval,
  height = 320,
}: {
  symbol: string;
  quoteSymbol?: string;
  name?: string;
  /** Headline price; omit or 0 to hide. */
  price?: number;
  /** Change as a fraction (0.012 = +1.2%); omit to hide. */
  changePct?: number | null;
  /** Optional badge on the right of the header row (e.g. "sim · indicative"). */
  tag?: ReactNode;
  /**
   * Optional second header line. The live swap desk puts the executable pair
   * rate here: the chart is denominated in USD, so the rate needs its own
   * labelled line rather than sharing the headline slot.
   */
  note?: ReactNode;
  candles: Candle[];
  interval: ChartInterval;
  status?: "ok" | "load" | "empty";
  onInterval?: (iv: ChartInterval) => void;
  height?: number;
}) {
  const up = (changePct ?? 0) >= 0;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-panel shadow-xl">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-lg leading-tight">{symbol}</h2>
            {quoteSymbol ? <span className="font-mono text-[11px] text-subtle">/ {quoteSymbol}</span> : null}
            {price && price > 0 ? (
              <span className={cn("font-mono text-sm tabular-nums", up ? "text-up" : "text-down")}>{fmtPx(price)}</span>
            ) : null}
            {changePct != null ? (
              <span className={cn("font-mono text-[11px]", up ? "text-up" : "text-down")}>
                {up ? "+" : "−"}
                {(Math.abs(changePct) * 100).toFixed(2)}%
              </span>
            ) : null}
            {tag}
          </div>
          {name ? (
            <span className="truncate pl-2 font-mono text-[10px] uppercase tracking-wider text-subtle">{name}</span>
          ) : null}
        </div>
        {note ? <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">{note}</p> : null}
      </div>
      <ChartPane candles={candles} interval={interval} status={status} onInterval={onInterval} compact={height} />
    </div>
  );
}
