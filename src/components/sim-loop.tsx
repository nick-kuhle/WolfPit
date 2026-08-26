import { useEffect } from "react";
import { useDesk, wpitListing } from "@/lib/wolfpit/desk";
import { getLiveMarket, getUniverse } from "@/lib/wolfpit/market";
import { useWolf } from "@/lib/wolfpit/store";
import { useTerms } from "@/lib/wolfpit/terms";

export function SimLoop() {
  const speed = useWolf((s) => s.simSpeed);
  const step = useWolf((s) => s.step);
  const rehydrate = useWolf((s) => s.rehydrate);
  const rehydrateTerms = useTerms((s) => s.rehydrate);
  const applyLive = useWolf((s) => s.applyLive);
  const setUniverse = useDesk((s) => s.setUniverse);
  const setFocus = useDesk((s) => s.setFocus);
  useEffect(() => {
    rehydrate();
    rehydrateTerms();
  }, [rehydrate, rehydrateTerms]);
  useEffect(() => {
    let dead = false;
    const pull = () => {
      void getLiveMarket({ data: { interval: "1m" } })
        .then((feed) => {
          if (!dead) applyLive(feed);
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
          const cur = useDesk.getState().focus;
          if (cur.symbol === "WPIT") setFocus({ ...wpit });
          else {
            const same = next.find((r) => r.symbol === cur.symbol);
            if (same && !cur.network) setFocus({ ...cur, ...same });
          }
        })
        .catch(() => {
          if (dead) return;
          const wolf = useWolf.getState();
          setUniverse([wpitListing(wolf.wpit, 0.12)]);
        });
    };
    pull();
    const id = window.setInterval(pull, 15_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [applyLive, setUniverse]);
  useEffect(() => {
    const id = window.setInterval(() => step(speed), 1000);
    return () => window.clearInterval(id);
  }, [speed, step]);
  return null;
}
