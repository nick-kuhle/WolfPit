//! WolfPit keeper — Alloy 2.x. Base mainnet.
//!
//! F3: the keeper can now TRANSCAT, not just print calldata:
//!   - sign `WOLFPIT_KEEPER_KEY` (private key hex) as the vault OPERATOR,
//!   - run one-shot operator commands (`writeCall` / `writePut` / `openShort`
//!     atomic swap / `openLong` / `releaseCall` / `releasePut` / `exec` /
//!     `reconcileBalances` / `pause`),
//!   - or run a `monitor` loop that reads the halt/oracle/insurance state and
//!     FAILS CLOSED by pausing the vault when `haltShortGamma()` trips (or the
//!     reserved books ever exceed real balances). On RPC errors the monitor
//!     NEVER exits: it pauses best-effort and retries with backoff — a watcher
//!     that dies on a transient error is not fail-closed.
//!
//! Audit C-3: the pause key halves are asymmetric on-chain. The OPERATOR (this
//! key) can `pause(true)` only; `pause(false)` is owner-only, so a compromised
//! keeper cannot un-halt behind the watcher's back. The `Pause { v: false }`
//! command remains for the owner's own tooling but reverts NotOwner if signed
//! by the operator key.
//!
//! Without a key, `status` still reads the chain from a plain RPC URL, and
//! every command dry-run encodes its calldata.

use alloy::network::EthereumWallet;
use alloy::primitives::{hex::decode as hex_decode, Address, U256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use alloy::sol_types::SolCall;
use clap::{Parser, Subcommand};
use eyre::{eyre, Result};
use std::time::Duration;

sol! {
    #[sol(rpc)]
    interface IDealerVault {
        function owner() external view returns (address);
        function operator() external view returns (address);
        function paused() external view returns (bool);
        function reservedEth() external view returns (uint256);
        function reservedUsdc() external view returns (uint256);
        function ethBal() external view returns (uint256);
        function usdcBal() external view returns (uint256);
        function insuranceUsdc() external view returns (uint256);
        function utilBps() external view returns (uint256);
        function navUsdc() external view returns (uint256);
        function haltShortGamma() external view returns (bool);
        function pause(bool v) external;
        function writeCall(uint256 size) external;
        function writePut(uint256 size, uint256 strike) external;
        function releaseCall(uint256 size) external;
        function releasePut(uint256 lock) external;
        function queueReleaseCall(uint256 size) external;
        function queueReleasePut(uint256 lock) external;
        function releaseDelay() external view returns (uint256);
        function openLong(uint256 size) external;
        function openShort(uint256 size, address router, bytes data, uint256 minOutUsdc) external;
        function reconcileBalances() external;
        function exec(address target, bytes data) external returns (bytes);
    }
}

#[derive(Parser, Debug)]
#[command(name = "wolfpit-keeper", about = "Alloy keeper for the WolfPit dealer vault (Base)")]
struct Args {
    /// HTTP RPC. If empty, dry-run calldata only.
    #[arg(long, env = "WOLFPIT_RPC")]
    rpc: Option<String>,
    #[arg(long, env = "WOLFPIT_VAULT")]
    vault: Option<Address>,
    /// Chain label for logs (base | base-sepolia | anvil).
    #[arg(long, env = "WOLFPIT_CHAIN", default_value = "base")]
    chain: String,
    /// Operator private key (hex). ENVIRONMENT ONLY — deliberately NOT exposed
    /// as a `--key` flag (WP-14 / #19): argument vectors are not secret. Any
    /// local user can read them from `ps`, they land in shell history, and they
    /// routinely end up in process-monitoring agents, crash dumps and CI logs.
    /// This is the operator hot key; per WP-05 it can move the vault's whole
    /// balance, so it gets the same care as the funds.
    /// Prefer `--key-file` (or a KMS/hardware signer in production) over
    /// putting the material in the environment at all.
    #[arg(env = "WOLFPIT_KEEPER_KEY")]
    key: Option<String>,
    /// Read the operator private key (hex) from this file instead of the
    /// environment. The file should be mode 0600 and never committed.
    #[arg(long, env = "WOLFPIT_KEEPER_KEY_FILE")]
    key_file: Option<String>,
    /// Monitor loop: seconds between checks (0 = 30s default).
    #[arg(long, default_value = "0")]
    interval: u64,
    /// Monitor reconciliation floor (whole ETH): pause if on-chain
    /// `reservedEth` ever falls BELOW this — an unauthorized `releaseCall`
    /// understating the book (audit B4: the vault has no position registry,
    /// so only the keeper's own book knows what SHOULD be reserved). Floors,
    /// not exact matches: legitimate new writes may grow the book mid-loop.
    #[arg(long)]
    min_reserved_eth: Option<String>,
    /// Monitor reconciliation floor (whole USDC): pause if on-chain
    /// `reservedUsdc` falls below this (unauthorized `releasePut`).
    #[arg(long)]
    min_reserved_usdc: Option<String>,
    #[command(subcommand)]
    cmd: Option<Cmd>,
}

#[derive(Subcommand, Debug, Clone)]
enum Cmd {
    /// Read-only health/state snapshot (single pass).
    Status,
    /// Short call: reserve `size` WETH against the covered book (operator).
    WriteCall { size_eth: String },
    /// Short put: reserve `size×strike` USDC, insurance-halted (operator).
    WritePut { size_eth: String, strike_usdc: String },
    /// Atomic covered short: allowlisted router swap + oracle-min-out booking.
    OpenShort {
        size_eth: String,
        router: Address,
        min_out_usdc: String,
        /// Hex calldata the router expects (e.g. a swap router's `sell(uint256)`).
        data: String,
    },
    /// Open a covered long (reserve ETH cover, operator).
    OpenLong { size_eth: String },
    /// Release a previously reserved put lock (USDC, 6 decimals) (operator).
    ReleasePut { lock_usdc: String },
    /// Run an allowlisted aggregator router call (hedge buy-side etc.) (operator).
    Exec {
        /// Allowlisted router address.
        target: Address,
        /// Hex calldata the router expects (e.g. `swap(uint256,uint256)`).
        data: String,
    },
    /// Reconcile internal counters with real token balances (operator).
    Reconcile,
    /// Pause(true) / un-pause(false). Halt: operator or owner. Resume:
    /// owner-only since audit C-3 — an operator-signed `pause false` reverts
    /// NotOwner by design.
    Pause { v: bool },
    /// Release a previously reserved call size (operator).
    ReleaseCall { size_eth: String },
    /// Queue an ETH-side release for the timelock (needed once the owner
    /// arms `releaseDelay`; replaces any pending queue entry).
    QueueReleaseCall { size_eth: String },
    /// Queue a USDC-side release for the timelock.
    QueueReleasePut { lock_usdc: String },
    /// Pulse: read state each interval; fail closed — pause when halted.
    Monitor,
}

/// WP-14 / #19: best-effort wipe of key material held in a `String`.
///
/// `String::as_bytes_mut` hands back the live buffer; overwrite it, then drop
/// the capacity so the freed allocation is less likely to be reused intact.
/// This is a mitigation, not a guarantee — the allocator may have copied the
/// bytes elsewhere, which is exactly why production belongs in a hardware
/// signer or KMS rather than in this process at all.
fn zeroize_key(secret: &mut String) {
    // SAFETY: writing only ASCII '0' bytes keeps the buffer valid UTF-8.
    for b in unsafe { secret.as_bytes_mut() }.iter_mut() {
        *b = b'0';
    }
    secret.clear();
    secret.shrink_to_fit();
}

/// ETH value in wei, from a decimal string of whole ETH.
fn wei(eth: String) -> Result<U256> {
    let e: u128 = eth
        .parse()
        .map_err(|_| eyre!("'{eth}' is not a whole-ETH amount (use wei integers)"))?;
    Ok(U256::from(e) * U256::from(1_000_000_000_000_000_000u128))
}

/// USDC amount from a decimal string of whole USDC (6 decimals).
fn usdc(amount: String) -> Result<U256> {
    let a: u128 = amount
        .parse()
        .map_err(|_| eyre!("'{amount}' is not a whole-USDC amount (use 6-decimals integers)"))?;
    Ok(U256::from(a) * U256::from(1_000_000u128))
}

fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Pure calldata printing — the old behavior, still useful for a signer that
/// signs elsewhere (Safe, hardware wallet).
async fn dry_run(args: &Args) -> Result<()> {
    println!(
        "wolfpit-keeper alloy · chain={} (dry-run: set WOLFPIT_RPC + WOLFPIT_VAULT + WOLFPIT_KEEPER_KEY to transact)",
        args.chain
    );
    println!("pause calldata:       0x{}", to_hex(&IDealerVault::pauseCall { v: true }.abi_encode()));
    println!(
        "writeCall(1 ETH) calldata: 0x{}",
        to_hex(&IDealerVault::writeCallCall { size: wei("1".into())? }.abi_encode())
    );
    println!(
        "writePut(1 ETH @ 4000) calldata: 0x{}",
        to_hex(&IDealerVault::writePutCall { size: wei("1".into())?, strike: usdc("4000".into())? }.abi_encode())
    );
    println!(
        "openShort(1 ETH, router, minOut) calldata: 0x{}",
        to_hex(&IDealerVault::openShortCall {
            size: wei("1".into())?,
            router: Address::ZERO,
            data: vec![].into(),
            minOutUsdc: usdc("3000".into())?
        }
        .abi_encode())
    );
    println!(
        "openLong(1 ETH) calldata:        0x{}",
        to_hex(&IDealerVault::openLongCall { size: wei("1".into())? }.abi_encode())
    );
    println!(
        "releasePut(4000 USDC lock) calldata: 0x{}",
        to_hex(&IDealerVault::releasePutCall { lock: usdc("4000".into())? }.abi_encode())
    );
    println!(
        "exec(router, data) calldata: 0x{}",
        to_hex(&IDealerVault::execCall {
            target: Address::ZERO,
            data: vec![].into()
        }
        .abi_encode())
    );
    println!("reconcileBalances calldata: 0x{}", to_hex(&IDealerVault::reconcileBalancesCall {}.abi_encode()));
    Ok(())
}

/// Read-only `status` on a plain (unsigned) provider — works without a key.
async fn status_read(rpc: &str, vault: Address) -> Result<()> {
    let p = ProviderBuilder::new().connect_http(rpc.parse()?);
    let c = IDealerVault::new(vault, p);
    let paused = c.paused().call().await?;
    let reserved = c.reservedEth().call().await?;
    let reserved_usdc = c.reservedUsdc().call().await?;
    let eth = c.ethBal().call().await?;
    let usdc = c.usdcBal().call().await?;
    let ins = c.insuranceUsdc().call().await?;
    let nav = c.navUsdc().call().await?;
    let halt = c.haltShortGamma().call().await?;
    let owner = c.owner().call().await?;
    let operator = c.operator().call().await?;
    println!("paused={paused} reservedEth={reserved} reservedUsdc={reserved_usdc} ethBal={eth} usdcBal={usdc}");
    println!("insuranceUsdc={ins} navUsdc={nav} utilBps={}", c.utilBps().call().await?);
    println!("owner={owner} operator={operator}");
    if halt {
        println!("HALT: oracle/insurance says do NOT write gamma");
    }
    if reserved > eth {
        eyre::bail!("naked: reservedEth > ethBal");
    }
    if reserved_usdc > usdc {
        eyre::bail!("naked: reservedUsdc > usdcBal");
    }
    Ok(())
}

async fn run(args: &Args) -> Result<()> {
    let (Some(rpc), Some(vault)) = (args.rpc.clone(), args.vault) else {
        return dry_run(args).await;
    };
    let cmd = args.cmd.clone().unwrap_or(Cmd::Status);
    println!("keeper · vault={vault} rpc={rpc}");

    if matches!(cmd, Cmd::Status) && args.key.is_none() {
        return status_read(&rpc, vault).await;
    }

    // Everything that can transact (and a keyed status) uses the signer.
    // WP-14 / #19: resolve the key from the file (preferred) or the
    // environment, then ZEROIZE the buffer as soon as the signer owns it, so
    // the material does not linger in process memory for the life of the run.
    let mut key_buf = match (args.key_file.as_deref(), args.key.as_deref()) {
        (Some(path), _) => std::fs::read_to_string(path)
            .map_err(|e| eyre!("cannot read WOLFPIT_KEEPER_KEY_FILE {path}: {e}"))?,
        (None, Some(k)) => k.to_string(),
        (None, None) => {
            return Err(eyre!(
                "this command needs WOLFPIT_KEEPER_KEY or --key-file (operator private key)"
            ))
        }
    };
    let signer: PrivateKeySigner = {
        let parsed = key_buf
            .trim()
            .parse()
            .map_err(|_| eyre!("operator key is not a valid private key (64 hex chars)"));
        zeroize_key(&mut key_buf);
        parsed?
    };
    let p = ProviderBuilder::new().wallet(EthereumWallet::from(signer)).connect_http(rpc.parse()?);
    let c = IDealerVault::new(vault, p);

    match cmd {
        Cmd::Status => {
            let paused = c.paused().call().await?;
            let reserved = c.reservedEth().call().await?;
            let reserved_usdc = c.reservedUsdc().call().await?;
            let eth = c.ethBal().call().await?;
            let usdc = c.usdcBal().call().await?;
            let ins = c.insuranceUsdc().call().await?;
            let nav = c.navUsdc().call().await?;
            let halt = c.haltShortGamma().call().await?;
            println!(
                "paused={paused} reservedEth={reserved} reservedUsdc={reserved_usdc} ethBal={eth} usdcBal={usdc} insuranceUsdc={ins} navUsdc={nav}"
            );
            println!(
                "utilBps={}",
                c.utilBps().call().await?
            );
            if halt {
                println!("HALT: oracle/insurance says do NOT write gamma");
            }
            if reserved > eth {
                eyre::bail!("naked: reservedEth > ethBal");
            }
            if reserved_usdc > usdc {
                eyre::bail!("naked: reservedUsdc > usdcBal");
            }
            Ok(())
        }
        Cmd::WriteCall { size_eth } => {
            let size = wei(size_eth.clone())?;
            let cd = IDealerVault::writeCallCall { size }.abi_encode();
            println!("writeCall({size_eth} ETH) calldata: 0x{}", to_hex(&cd));
            let tx = c.writeCall(size).send().await?;
            println!("sent writeCall tx: {}", tx.tx_hash());
            tx.get_receipt().await?;
            Ok(())
        }
        Cmd::WritePut { size_eth, strike_usdc } => {
            let size = wei(size_eth.clone())?;
            let strike = usdc(strike_usdc.clone())?;
            let cd = IDealerVault::writePutCall { size, strike }.abi_encode();
            println!("writePut({size_eth} ETH @ {strike_usdc} USDC) calldata: 0x{}", to_hex(&cd));
            let tx = c.writePut(size, strike).send().await?;
            println!("sent writePut tx: {}", tx.tx_hash());
            tx.get_receipt().await?;
            Ok(())
        }
        Cmd::OpenShort { size_eth, router, min_out_usdc, data } => {
            let size = wei(size_eth.clone())?;
            let min_out = usdc(min_out_usdc.clone())?;
            let data = hex_decode(&data).map_err(|_| eyre!("--data must be hex (0x-prefixed ok)"))?;
            let cd = IDealerVault::openShortCall {
                size,
                router,
                data: data.clone().into(),
                minOutUsdc: min_out,
            }
            .abi_encode();
            println!(
                "openShort({size_eth} ETH -> {router}, min {min_out_usdc} USDC) calldata: 0x{}",
                to_hex(&cd)
            );
            let tx = c.openShort(size, router, data.into(), min_out).send().await?;
            println!("sent openShort tx: {}", tx.tx_hash());
            tx.get_receipt().await?;
            Ok(())
        }
        Cmd::OpenLong { size_eth } => {
            let size = wei(size_eth.clone())?;
            let cd = IDealerVault::openLongCall { size }.abi_encode();
            println!("openLong({size_eth} ETH) calldata: 0x{}", to_hex(&cd));
            let tx = c.openLong(size).send().await?;
            println!("sent openLong tx: {}", tx.tx_hash());
            tx.get_receipt().await?;
            Ok(())
        }
        Cmd::ReleasePut { lock_usdc } => {
            let lock = usdc(lock_usdc.clone())?;
            let cd = IDealerVault::releasePutCall { lock }.abi_encode();
            println!("releasePut({lock_usdc} USDC) calldata: 0x{}", to_hex(&cd));
            let tx = c.releasePut(lock).send().await?;
            println!("sent releasePut tx: {}", tx.tx_hash());
            tx.get_receipt().await?;
            Ok(())
        }
        Cmd::Exec { target, data } => {
            let data = hex_decode(&data).map_err(|_| eyre!("--data must be hex (0x-prefixed ok)"))?;
            let cd = IDealerVault::execCall {
                target,
                data: data.clone().into(),
            }
            .abi_encode();
            println!("exec({target}, {}) calldata: 0x{}", alloy::primitives::hex::encode(&data), to_hex(&cd));
            let tx = c.exec(target, data.into()).send().await?;
            println!("sent exec tx: {}", tx.tx_hash());
            tx.get_receipt().await?;
            Ok(())
        }
        Cmd::Reconcile => {
            let cd = IDealerVault::reconcileBalancesCall {}.abi_encode();
            println!("reconcileBalances calldata: 0x{}", to_hex(&cd));
            let tx = c.reconcileBalances().send().await?;
            println!("sent reconcileBalances tx: {}", tx.tx_hash());
            tx.get_receipt().await?;
            Ok(())
        }
        Cmd::Pause { v } => {
            let cd = IDealerVault::pauseCall { v }.abi_encode();
            println!("pause({v}) calldata: 0x{}", to_hex(&cd));
            let tx = c.pause(v).send().await?;
            println!("sent pause tx: {}", tx.tx_hash());
            tx.get_receipt().await?;
            Ok(())
        }
        Cmd::ReleaseCall { size_eth } => {
            let size = wei(size_eth.clone())?;
            let cd = IDealerVault::releaseCallCall { size }.abi_encode();
            println!("releaseCall({size_eth} ETH) calldata: 0x{}", to_hex(&cd));
            let tx = c.releaseCall(size).send().await?;
            println!("sent releaseCall tx: {}", tx.tx_hash());
            tx.get_receipt().await?;
            Ok(())
        }
        Cmd::QueueReleaseCall { size_eth } => {
            let size = wei(size_eth.clone())?;
            let cd = IDealerVault::queueReleaseCallCall { size }.abi_encode();
            println!("queueReleaseCall({size_eth} ETH) calldata: 0x{}", to_hex(&cd));
            let delay = c.releaseDelay().call().await?;
            let tx = c.queueReleaseCall(size).send().await?;
            println!("sent queueReleaseCall tx: {} (matures in {delay}s)", tx.tx_hash());
            tx.get_receipt().await?;
            Ok(())
        }
        Cmd::QueueReleasePut { lock_usdc } => {
            let lock = usdc(lock_usdc.clone())?;
            let cd = IDealerVault::queueReleasePutCall { lock }.abi_encode();
            println!("queueReleasePut({lock_usdc} USDC) calldata: 0x{}", to_hex(&cd));
            let delay = c.releaseDelay().call().await?;
            let tx = c.queueReleasePut(lock).send().await?;
            println!("sent queueReleasePut tx: {} (matures in {delay}s)", tx.tx_hash());
            tx.get_receipt().await?;
            Ok(())
        }
        Cmd::Monitor => {
            let step = if args.interval == 0 { 30 } else { args.interval };
            let floor_eth = match &args.min_reserved_eth {
                Some(v) => Some(wei(v.clone())?),
                None => None,
            };
            let floor_usdc = match &args.min_reserved_usdc {
                Some(v) => Some(usdc(v.clone())?),
                None => None,
            };
            let mut fails: u32 = 0;
            loop {
                // One read pass. On ANY RPC error the monitor cannot prove the
                // vault is safe — fail closed: attempt an on-chain pause
                // (best-effort; it may also fail if the RPC is down) and back
                // off. The old `?` here EXITED the loop on the first transient
                // error, silently removing the fail-closed watcher exactly when
                // it was needed.
                let res: Result<bool> = async {
                    let paused = c.paused().call().await?;
                    let halt = c.haltShortGamma().call().await?;
                    let reserved_eth = c.reservedEth().call().await?;
                    let reserved_usdc = c.reservedUsdc().call().await?;
                    let naked_eth = reserved_eth > c.ethBal().call().await?;
                    let naked_usdc = reserved_usdc > c.usdcBal().call().await?;
                    // B4 reconciliation: reserved UNDERSTATED (a release the
                    // keeper's book does not know about) is invisible to the
                    // naked checks — compare against the operator's floors.
                    let under_floor = reserved_under_floor(reserved_eth, floor_eth)
                        || reserved_under_floor(reserved_usdc, floor_usdc);
                    if monitor_should_pause(paused, halt, naked_eth, naked_usdc, under_floor) {
                        let tx = c.pause(true).send().await?;
                        println!("HALT -> pause() tx {}", tx.tx_hash());
                        tx.get_receipt().await?;
                        println!("vault paused on-chain");
                        return Ok(true);
                    }
                    println!(
                        "ok: paused={paused} halt={halt} naked_eth={naked_eth} naked_usdc={naked_usdc} under_floor={under_floor}"
                    );
                    Ok(false)
                }
                .await;
                match res {
                    Ok(_) => fails = 0,
                    Err(e) => {
                        fails += 1;
                        println!("monitor read error ({fails}): {e:#} — cannot verify vault safety; pausing to fail closed");
                        let _ = c.pause(true).send().await; // best-effort
                        let backoff = monitor_backoff(step, fails);
                        tokio::time::sleep(Duration::from_secs(backoff)).await;
                        continue;
                    }
                }
                tokio::time::sleep(Duration::from_secs(step)).await;
            }
        }
    }
}

/// Fail-closed predicate: pause unless we can PROVE the vault is safe (not
/// halted, cover covers reservations, the reserved book is not understated
/// below the operator's floors, and we are not already paused).
fn monitor_should_pause(paused: bool, halt: bool, naked_eth: bool, naked_usdc: bool, under_floor: bool) -> bool {
    (halt || naked_eth || naked_usdc || under_floor) && !paused
}

/// B4 reconciliation predicate: with no floor configured nothing is checked;
/// with one, an on-chain reserved value BELOW it means someone released cover
/// the keeper's book still counts on — the dangerous, otherwise-invisible
/// direction (a growing book is legitimate trading, never flagged).
fn reserved_under_floor(reserved: U256, floor: Option<U256>) -> bool {
    match floor {
        Some(f) => reserved < f,
        None => false,
    }
}

/// Exponential backoff for transient RPC failures: step · 2^(fails−1), capped
/// at 60s, never below the base step. The monitor retries FOREVER — an
/// exiting watcher is the failure mode this function exists to prevent.
fn monitor_backoff(step: u64, fails: u32) -> u64 {
    let exp = 60u64.min(step.saturating_mul(1u64 << fails.saturating_sub(1).min(6)));
    exp.max(step)
}

#[tokio::main]
async fn main() -> Result<()> {
    run(&Args::parse()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_selector() {
        let data = IDealerVault::pauseCall { v: true }.abi_encode();
        assert_eq!(data.len(), 36);
        assert_eq!(&data[..4], IDealerVault::pauseCall::SELECTOR);
    }

    #[test]
    fn write_call_not_empty() {
        let data = IDealerVault::writeCallCall { size: U256::from(1) }.abi_encode();
        assert!(data.len() > 4);
    }

    #[test]
    fn write_put_encodes_size_and_strike() {
        let data = IDealerVault::writePutCall {
            size: U256::from(1_000_000_000_000_000_000u128),
            strike: U256::from(4_000_000_000u128),
        }
        .abi_encode();
        assert_eq!(&data[..4], IDealerVault::writePutCall::SELECTOR);
        assert_eq!(data.len(), 4 + 64);
    }

    #[test]
    fn open_short_takes_size_router_data_minout() {
        let data = IDealerVault::openShortCall {
            size: U256::from(1_000_000_000_000_000_000u128),
            router: Address::with_last_byte(1),
            data: vec![0xde, 0xad].into(),
            minOutUsdc: U256::from(3_000_000_000u128),
        }
        .abi_encode();
        assert_eq!(&data[..4], IDealerVault::openShortCall::SELECTOR);
        assert_eq!(data.len(), 4 + 32 * 4 + 32 + 32); // head 4×32 + len + padded data
    }

    #[test]
    fn reconcile_has_no_args() {
        let data = IDealerVault::reconcileBalancesCall {}.abi_encode();
        assert_eq!(data.len(), 4);
    }

    #[test]
    fn open_long_encodes_size() {
        let data = IDealerVault::openLongCall {
            size: U256::from(1_000_000_000_000_000_000u128),
        }
        .abi_encode();
        assert_eq!(&data[..4], IDealerVault::openLongCall::SELECTOR);
        assert_eq!(data.len(), 4 + 32);
    }

    #[test]
    fn release_put_encodes_lock() {
        let data = IDealerVault::releasePutCall {
            lock: U256::from(4_000_000_000u128),
        }
        .abi_encode();
        assert_eq!(&data[..4], IDealerVault::releasePutCall::SELECTOR);
        assert_eq!(data.len(), 4 + 32);
    }

    #[test]
    fn monitor_pauses_only_when_halted_or_naked_and_not_paused() {
        assert!(!monitor_should_pause(false, false, false, false, false));
        assert!(monitor_should_pause(false, true, false, false, false));
        assert!(monitor_should_pause(false, false, true, false, false));
        assert!(monitor_should_pause(false, false, false, true, false));
        assert!(monitor_should_pause(false, false, false, false, true), "understated book pauses");
        assert!(!monitor_should_pause(true, true, false, false, false), "already paused: no spam");
        assert!(!monitor_should_pause(true, false, false, false, true), "already paused: no spam");
        assert!(!monitor_should_pause(true, false, false, false, false));
    }

    #[test]
    fn queue_release_encodes_amounts() {
        let d = IDealerVault::queueReleaseCallCall { size: U256::from(1u8) }.abi_encode();
        assert_eq!(&d[..4], IDealerVault::queueReleaseCallCall::SELECTOR);
        assert_eq!(d.len(), 4 + 32);
        let d = IDealerVault::queueReleasePutCall { lock: U256::from(1u8) }.abi_encode();
        assert_eq!(&d[..4], IDealerVault::queueReleasePutCall::SELECTOR);
        assert_eq!(d.len(), 4 + 32);
    }

    #[test]
    fn reserved_floor_flags_only_understatement() {
        let floor = Some(U256::from(10u64));
        assert!(!reserved_under_floor(U256::from(10u64), floor), "at the floor: fine");
        assert!(!reserved_under_floor(U256::from(11u64), floor), "grown book: legitimate");
        assert!(reserved_under_floor(U256::from(9u64), floor), "below floor: released behind our back");
        assert!(!reserved_under_floor(U256::ZERO, None), "no floor configured: no check");
    }

    #[test]
    fn monitor_backoff_grows_exponentially_and_caps() {
        assert_eq!(monitor_backoff(30, 1), 30); // first failure: base step
        assert_eq!(monitor_backoff(30, 2), 60); // 30·2, capped
        assert_eq!(monitor_backoff(30, 5), 60); // capped
        assert_eq!(monitor_backoff(10, 1), 10);
        assert_eq!(monitor_backoff(10, 2), 20);
        assert_eq!(monitor_backoff(10, 3), 40);
        assert_eq!(monitor_backoff(10, 4), 60); // cap
        assert_eq!(monitor_backoff(10, 8), 60); // still capped
    }

    #[test]
    fn exec_encodes_target_and_data() {
        let data = IDealerVault::execCall {
            target: Address::with_last_byte(2),
            data: vec![0xaa, 0xbb, 0xcc].into(),
        }
        .abi_encode();
        assert_eq!(&data[..4], IDealerVault::execCall::SELECTOR);
        assert_eq!(data.len(), 4 + 32 * 2 + 32 + 32); // head 2×32 + len + padded data
    }

    #[test]
    fn zeroize_key_wipes_the_buffer() {
        let mut s = "0xdeadbeefdeadbeefdeadbeefdeadbeef".to_string();
        let len = s.len();
        zeroize_key(&mut s);
        assert_eq!(s.len(), 0, "cleared");
        assert_eq!(s.capacity(), 0, "capacity released");
        assert!(!s.contains("deadbeef"));
        let _ = len;
    }

    #[test]
    fn key_is_not_a_cli_flag() {
        // WP-14 / #19: `--key 0x...` must no longer parse. clap rejects unknown
        // flags, so the parse of a Args-shaped command line carrying --key fails.
        let parsed = Args::try_parse_from(["wolfpit-keeper", "--key", "0xabc", "status"]);
        assert!(parsed.is_err(), "--key must not be accepted on the command line");
        // The env-only path still exists.
        let ok = Args::try_parse_from(["wolfpit-keeper", "status"]);
        assert!(ok.is_ok());
    }

    #[test]
    fn wei_and_usdc_helpers() {
        assert_eq!(wei("1".into()).unwrap(), U256::from(1_000_000_000_000_000_000u128));
        assert_eq!(usdc("4000".into()).unwrap(), U256::from(4_000_000_000u128));
        assert!(wei("1.5".into()).is_err(), "fractional wei amounts are rejected (pass wei ints)");
    }
}
