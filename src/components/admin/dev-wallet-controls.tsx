import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  buildApprove,
  buildMint,
  buildPoolAdd,
  buildSetPrice,
  devControlsAvailable,
  type BuildResult,
} from "@/lib/admin/dev-controls";
import { useWallet } from "@/lib/wallet/session";

/**
 * Testnet dev-wallet controls: mint test tokens, top up a pool, move the
 * manual oracle.
 *
 * The server holds NO key. Every button here builds calldata and hands it to
 * the operator's own wallet to sign — if this app is compromised, the attacker
 * gets a form, not a mint. `docs/DEV.md` requires it and Phase 3 keeps it.
 *
 * On Base mainnet this component renders `null`: the controls are absent, not
 * greyed out. A disabled mint button is one bad conditional from a live one.
 */
type EthProvider = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

function env(key: string): string | undefined {
  try {
    const v = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
    return v && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

const TOKENS = [
  { key: "VITE_USDC_SEPOLIA", symbol: "tUSDC", decimals: 6 },
  { key: "VITE_WETH_SEPOLIA", symbol: "tWETH", decimals: 18 },
  { key: "VITE_WPIT_SEPOLIA", symbol: "WPIT", decimals: 18 },
] as const;

export function DevWalletControls() {
  const { address, chainId } = useWallet();
  const [amount, setAmount] = useState("1000");
  const [tokenIdx, setTokenIdx] = useState(0);
  const [price, setPrice] = useState("4000");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const token = TOKENS[tokenIdx]!;
  const oracle = env("VITE_ORACLE_SEPOLIA");
  const pool = env("VITE_POOL_ETH_USDC_SEPOLIA");

  const available = devControlsAvailable(chainId);

  /** Send one built call through the operator's wallet. */
  const send = useCallback(
    async (built: BuildResult) => {
      setNote(null);
      if (!built.ok) {
        setNote({ tone: "bad", text: built.error });
        return;
      }
      const provider = (window as unknown as { ethereum?: EthProvider }).ethereum;
      if (!provider || !address) {
        setNote({ tone: "bad", text: "Connect the dev wallet first." });
        return;
      }
      setBusy(true);
      try {
        const hash = await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: address, to: built.call.to, data: built.call.data }],
        });
        setNote({ tone: "ok", text: `${built.call.label} — sent. ${String(hash).slice(0, 12)}…` });
      } catch (e) {
        // Say what failed. A control that fails silently is the bug we already
        // fixed once in this app.
        const msg = e instanceof Error ? e.message : String(e);
        setNote({ tone: "bad", text: msg.slice(0, 180) });
      } finally {
        setBusy(false);
      }
    },
    [address],
  );

  const poolLegs = useMemo(() => ({ eth: "1", usdc: price }), [price]);

  if (!available) return null;

  return (
    <section className="mt-4 rounded-[var(--radius-lg)] border border-brass/40 bg-brass/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Dev wallet · Base Sepolia</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-brass">test tokens only</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Every action below is signed by your connected wallet. The server never holds a key and cannot mint on your
        behalf. These controls do not exist on Base mainnet.
      </p>

      {!address && <p className="mt-3 text-xs text-warn">Connect the dev wallet to enable these controls.</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
        <label className="text-xs text-muted">
          Token
          <select
            value={tokenIdx}
            onChange={(e) => setTokenIdx(Number(e.target.value))}
            className="mt-1 block h-11 w-full rounded-[var(--radius-md)] border border-border bg-elevated px-2 text-sm text-fg"
          >
            {TOKENS.map((t, i) => (
              <option key={t.key} value={i}>
                {t.symbol}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Amount
          <input
            value={amount}
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 block h-11 w-full rounded-[var(--radius-md)] border border-border bg-elevated px-2 font-mono text-sm text-fg"
          />
        </label>
        <Button
          disabled={busy || !address}
          onClick={() =>
            void send(
              buildMint({
                chainId,
                token: env(token.key),
                to: address ?? undefined,
                amount,
                decimals: token.decimals,
                symbol: token.symbol,
              }),
            )
          }
        >
          Mint to me
        </Button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="text-xs text-muted">
          Oracle price (USDC per ETH)
          <input
            value={price}
            inputMode="decimal"
            onChange={(e) => setPrice(e.target.value)}
            className="mt-1 block h-11 w-full rounded-[var(--radius-md)] border border-border bg-elevated px-2 font-mono text-sm text-fg"
          />
        </label>
        <Button
          variant="outline"
          disabled={busy || !address || !oracle}
          onClick={() => void send(buildSetPrice({ chainId, oracle, usdPerEth: price }))}
        >
          Set price
        </Button>
        <Button
          variant="outline"
          disabled={busy || !address || !pool}
          onClick={() =>
            void send(
              buildApprove({
                chainId,
                token: env("VITE_WETH_SEPOLIA"),
                spender: pool,
                amount: poolLegs.eth,
                decimals: 18,
                symbol: "tWETH",
              }),
            )
          }
        >
          Approve 1 tWETH
        </Button>
      </div>

      <div className="mt-3">
        <Button
          variant="outline"
          disabled={busy || !address || !pool}
          onClick={() =>
            void send(
              buildPoolAdd({
                chainId,
                pool,
                amount0: poolLegs.eth,
                amount1: poolLegs.usdc,
                decimals0: 18,
                decimals1: 6,
                nowSec: Math.floor(Date.now() / 1000),
              }),
            )
          }
        >
          Top up ETH/USDC pool (1 tWETH + {price} tUSDC)
        </Button>
        <p className="mt-1 text-[11px] text-muted">
          Approve each leg first. The add carries a 15-minute deadline, so a stuck transaction expires instead of
          landing at a stale price.
        </p>
      </div>

      {note && (
        <p
          className={`mt-3 rounded-[var(--radius-md)] border p-2 text-xs ${
            note.tone === "ok" ? "border-border bg-elevated text-fg" : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {note.text}
        </p>
      )}
    </section>
  );
}
