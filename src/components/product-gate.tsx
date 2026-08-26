import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { TERMS_VERSION, useTerms } from "@/lib/wolfpit/terms";
import { ping } from "@/lib/wolfpit/alerts";
import { useWallet, truncAddr, chainName, hasInjectedWallet, dappUrl } from "@/lib/wallet/session";

export function ProductGate({
  children,
  product,
}: {
  children: ReactNode;
  product: string;
}) {
  const accepted = useTerms((s) => s.accepted && s.version === TERMS_VERSION);
  const rehydrate = useTerms((s) => s.rehydrate);
  const address = useWallet((s) => s.address);
  const readyW = useWallet((s) => s.ready);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    rehydrate();
    setReady(true);
  }, [rehydrate]);
  if (!ready || !readyW) return <div className="min-h-[50vh] bg-bg" />;
  if (!accepted) return <TermsWall product={product} />;
  if (!address) return <WalletWall product={product} />;
  return <>{children}</>;
}

function WalletWall({ product }: { product: string }) {
  const w = useWallet();
  const injected = typeof window !== "undefined" && hasInjectedWallet();
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">Profile · connect</p>
      <h1 className="mt-3 font-display text-3xl font-medium tracking-tight">Activate a profile to enter the {product}.</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Connect a web3 wallet. That address is your seat. Paper balances stay simulated until live pools are pointed at
        it.
      </p>
      <Button className="mt-6 w-full" disabled={w.connecting} onClick={() => void w.connect()}>
        {w.connecting ? "Waiting on wallet…" : "Connect wallet"}
      </Button>
      {!injected ? (
        <div className="mt-3 grid gap-2">
          <a
            className="h-11 rounded-[var(--radius-sm)] border border-border text-center text-sm leading-[2.75rem] text-muted"
            href={`https://metamask.app.link/dapp/${dappUrl().replace(/^https?:\/\//, "")}`}
          >
            Open in MetaMask
          </a>
          <a
            className="h-11 rounded-[var(--radius-sm)] border border-border text-center text-sm leading-[2.75rem] text-muted"
            href={`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(dappUrl())}`}
          >
            Open in Coinbase Wallet
          </a>
        </div>
      ) : null}
      {w.error ? <p className="mt-3 text-sm text-down">{w.error}</p> : null}
      <p className="mt-4 text-xs text-subtle">
        {w.address ? `${truncAddr(w.address)} · ${chainName(w.chainId)}` : "No session."}{" "}
        <Link to="/profile" className="text-brass hover:underline">
          Profile
        </Link>
      </p>
    </div>
  );
}

function TermsWall({ product }: { product: string }) {
  const accept = useTerms((s) => s.accept);
  const [ok, setOk] = useState(false);
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">Clickwrap · {TERMS_VERSION}</p>
      <h1 className="mt-3 font-display text-3xl font-medium tracking-tight">Agree before you enter the {product}.</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        WolfPit is a <strong className="text-fg">paper / simulation venue</strong>. Balances you see (including 1,000 ETH
        and 100,000 USDC) are not real assets. Yields are simulated. Derivatives are educational. Nothing here is an
        offer of securities, a solicitation, or investment advice.
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted">
        <li>You are at least 18 and legally able to enter a contract.</li>
        <li>You have read the Terms of Use, including risk, liability cap, and arbitration.</li>
        <li>You will not treat paper P&L, APYs, or fills as a promise of live-market results.</li>
        <li>U.S. persons may be geo-fenced from futures and options. You will not evade that control.</li>
      </ul>
      <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-[var(--color-brass)]"
          checked={ok}
          onChange={(e) => setOk(e.target.checked)}
        />
        <span>
          I have read and agree to the{" "}
          <Link to="/terms" className="text-brass underline-offset-2 hover:underline">
            Terms of Use
          </Link>
          , including Sections 2 (Simulation), 7 (Assumption of Risk), and 12 (Arbitration).
        </span>
      </label>
      <Button
        className="mt-6 w-full"
        disabled={!ok}
        onClick={() => {
          accept();
          ping("Terms accepted. The floor is open.", "up");
        }}
      >
        I agree — enter {product}
      </Button>
      <p className="mt-4 text-xs text-subtle">
        WolfPit Labs (the “Company”). Last revised {TERMS_VERSION}. Electronic signature under the E-SIGN Act.
      </p>
    </div>
  );
}
