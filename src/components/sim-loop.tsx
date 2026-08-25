import { useEffect } from "react";
import { getLiveMarket } from "@/lib/wolfpit/market";
import { useWolf } from "@/lib/wolfpit/store";

export function SimLoop() {
  const speed = useWolf((s) => s.simSpeed);
  const step = useWolf((s) => s.step);
  const rehydrate = useWolf((s) => s.rehydrate);
  const applyLive = useWolf((s) => s.applyLive);
  useEffect(() => {
    rehydrate();
  }, [rehydrate]);
  useEffect(() => {
    let dead = false;
    const pull = () => {
      void getLiveMarket({ data: { interval: "1m" } })
        .then((feed) => {
          if (!dead) applyLive(feed);
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 15_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [applyLive]);
  useEffect(() => {
    const id = window.setInterval(() => step(speed), 1000);
    return () => window.clearInterval(id);
  }, [speed, step]);
  return null;
}
