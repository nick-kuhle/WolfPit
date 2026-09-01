import { useEffect } from "react";
import { useDesk, wpitListing } from "@/lib/wolfpit/desk";
import { getLiveMarket, getUniverse, getVolHistory } from "@/lib/wolfpit/market";
import type { Candle } from "@/lib/wolfpit/types";
import { useWolf } from "@/lib/wolfpit/store";
import { useTerms } from "@/lib/wolfpit/terms";

export function SimLoop() {
  const speed = useWolf((s) => s.simSpeed);
  const step = useWolf((s) => s.step);
  const rehydrate = useWolf((s) => s.rehydrate);
  const rehydrateTerms = useTerms((s) => s.rehydrate);
  const applyLive = useWolf((s) => s.applyLive);
  const setUniverse = useDesk((s) => s.setUniverse);
  useEffect(() => {
    rehydrate();
    rehydrateTerms();
  }, [rehydrate, rehydrateTerms]);
  useEffect(() => {
    let dead = false;
    // The vol series is ~1h bars, so it does not need the chart's 15 s cadence.
    // Held here and merged into each applyLive call; null leaves the previous
    // series in place rather than degrading the estimate.
    let volCandles: Candle[] = [];
    const pullVol = () => {
      void getVolHistory({ data: {} })
        .then((v) => {
          if (!dead && v) volCandles = v.candles;
        })
        .catch(() => undefined);
    };
    const pull = () => {
      void getLiveMarket({ data: { interval: "1m" } })
        .then((feed) => {
          if (!dead) applyLive({ ...feed, volCandles });
        })
        .catch(() => undefined);
      void getUniverse()
        .then((raw) => {
          if (dead) return;
          const wolf = useWolf.getState();
          const ch24 =
            wolf.wpitCandles.length > 1 ? wolf.wpit / wolf.wpitCandles[0]!.c - 1 : 0.12;
          const wpit = wpitListing(wolf.wpit, ch24);
          const next = [wpit, ...raw.filter((r) => r.symbol !== "WPIT")];
          setUniverse(next);
        })
        .catch(() => {
          if (dead) return;
          const wolf = useWolf.getState();
          setUniverse([wpitListing(wolf.wpit, 0.12)]);
        });
    };
    pullVol();
    pull();
    const id = window.setInterval(pull, 15_000);
    // 1h bars move slowly; 10 minutes is far inside any staleness that matters.
    const volId = window.setInterval(pullVol, 600_000);
    return () => {
      dead = true;
      window.clearInterval(id);
      window.clearInterval(volId);
    };
  }, [applyLive, setUniverse]);
  useEffect(() => {
    const id = window.setInterval(() => step(speed), 1000);
    return () => window.clearInterval(id);
  }, [speed, step]);
  return null;
}
