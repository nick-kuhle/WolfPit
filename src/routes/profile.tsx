import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { useWallet, truncAddr, chainName, hasInjectedWallet, dappUrl } from "@/lib/wallet/session";
import { useWolf, useEquity } from "@/lib/wolfpit/store";
import { fmtUsd } from "@/lib/utils";

export const Route = createFileRoute("/profile")({ component: ProfilePage });

function ProfilePage() {
  const w = useWallet();
  const eq = useEquity();
  const reset = useWolf((s) => s.reset);
  const injected = typeof window !== "undefined" && hasInjectedWallet();

  return (
    <Shell>
      <main className="mx-auto max-w-md px-4 py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-brass">Profile · web3</p>
        <h1 className="mt-2 font-display text-4xl font-medium">Seat at the pit.</h1>
        <p className="mt-2 text-sm text-muted">
          Connect a wallet to login. Paper funds stay simulated — the address is your seat, not a deposit.
        </p>

        <div className="mt-8 rounded-[var(--radius-xl)] border border-border bg-panel p-5">
          {w.address ? (
            <>
              <div className="font-mono text-[10px] uppercase tracking-wider text-subtle">Connected</div>
              <div className="mt-1 font-display text-2xl">{truncAddr(w.address)}</div>
              <p className="mt-1 break-all font-mono text-[11px] text-muted">{w.address}</p>
              <p className="mt-3 font-mono text-sm text-brass">{chainName(w.chainId)}</p>
              <p className="mt-4 text-sm text-muted">
                Net liq {fmtUsd(eq)} paper. Wallet is identity only until live pools are pointed at this address.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Link to="/trade">
                  <Button className="h-12 w-full">Trade</Button>
                </Link>
                <Button variant="outline" className="h-12" onClick={() => w.disconnect()}>
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                {injected
                  ? "Wallet detected. Connect to activate your profile and unlock the desk."
                  : "No injected wallet in this browser. Open the pit inside MetaMask or Coinbase Wallet, or connect if the prompt appears."}
              </p>
              <Button className="mt-5 h-12 w-full" disabled={w.connecting} onClick={() => void w.connect()}>
                {w.connecting ? "Waiting on wallet…" : "Connect wallet"}
              </Button>
              {!injected ? (
                <div className="mt-3 grid gap-2">
                  <a
                    className="h-11 rounded-[var(--radius-sm)] border border-border px-3 text-center text-sm leading-[2.75rem] text-muted"
                    href={`https://metamask.app.link/dapp/${dappUrl().replace(/^https?:\/\//, "")}`}
                  >
                    Open in MetaMask
                  </a>
                  <a
                    className="h-11 rounded-[var(--radius-sm)] border border-border px-3 text-center text-sm leading-[2.75rem] text-muted"
                    href={`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(dappUrl())}`}
                  >
                    Open in Coinbase Wallet
                  </a>
                </div>
              ) : null}
              {w.error ? <p className="mt-3 text-sm text-down">{w.error}</p> : null}
            </>
          )}
        </div>

        {w.address ? (
          <button type="button" className="mt-6 text-sm text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => reset()}>
            Reset paper book
          </button>
        ) : null}
      </main>
    </Shell>
  );
}
