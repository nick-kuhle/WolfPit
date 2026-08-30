//! WolfPit keeper — Alloy 2.x. Base mainnet.
//! Dry-run encodes vault calls. With RPC, reads cover, insurance, and the
//! oracle-backed halt. Risk ops (`writeCall`, `openShort`, …) are
//! operator-gated on-chain: run this keeper from the vault's operator key.

use alloy::primitives::{Address, U256};
use alloy::sol;
use alloy::sol_types::SolCall;
use clap::Parser;
use eyre::Result;

sol! {
    #[sol(rpc)]
    interface IDealerVault {
        function owner() external view returns (address);
        function operator() external view returns (address);
        function paused() external view returns (bool);
        function reservedEth() external view returns (uint256);
        function ethBal() external view returns (uint256);
        function usdcBal() external view returns (uint256);
        function insuranceUsdc() external view returns (uint256);
        function utilBps() external view returns (uint256);
        function navUsdc() external view returns (uint256);
        function haltShortGamma() external view returns (bool);
        function pause(bool v) external;
        function writeCall(uint256 size) external;
        function releaseCall(uint256 size) external;
        function openShort(uint256 size) external;
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
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let pause_cd = IDealerVault::pauseCall { v: true }.abi_encode();
    let write_cd = IDealerVault::writeCallCall {
        size: U256::from(1_000_000_000_000_000_000u128),
    }
    .abi_encode();
    let swap_cd = IDealerVault::execCall {
        target: Address::ZERO,
        data: vec![].into(),
    }
    .abi_encode();
    println!("wolfpit-keeper alloy · chain={}", args.chain);
    println!("pause calldata:        0x{}", to_hex(&pause_cd));
    println!("writeCall(1 ETH) calldata: 0x{}", to_hex(&write_cd));
    println!("exec(router, data) calldata: 0x{}", to_hex(&swap_cd));

    if let (Some(rpc), Some(vault)) = (args.rpc, args.vault) {
        let provider = alloy::providers::ProviderBuilder::new().connect_http(rpc.parse()?);
        let c = IDealerVault::new(vault, provider);
        let paused = c.paused().call().await?;
        let reserved = c.reservedEth().call().await?;
        let eth = c.ethBal().call().await?;
        let ins = c.insuranceUsdc().call().await?;
        let nav = c.navUsdc().call().await?;
        let halt = c.haltShortGamma().call().await?;
        let owner = c.owner().call().await?;
        let operator = c.operator().call().await?;
        println!("vault {vault} rpc {rpc}");
        println!(
            "paused={paused} reservedEth={reserved} ethBal={eth} insurance={ins} nav={nav}"
        );
        println!("owner={owner} operator={operator}");
        if halt {
            println!("halt: oracle/insurance says do NOT write gamma");
        }
        if reserved > eth {
            eyre::bail!("naked: reservedEth > ethBal");
        }
    } else {
        println!("dry-run (set WOLFPIT_RPC + WOLFPIT_VAULT to read chain)");
    }
    Ok(())
}

fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
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
        let data = IDealerVault::writeCallCall {
            size: U256::from(1),
        }
        .abi_encode();
        assert!(data.len() > 4);
    }

    #[test]
    fn exec_selector_encodes_router_swap_envelope() {
        // exec(address,bytes) — the DEX-aggregator route envelope.
        let data = IDealerVault::execCall {
            target: Address::with_last_byte(1),
            data: vec![0xde, 0xad].into(),
        }
        .abi_encode();
        assert_eq!(&data[..4], IDealerVault::execCall::SELECTOR);
        // 4 selector + 32 address + 32 bytes-offset + 32 len + 32 padded data
        assert_eq!(data.len(), 4 + 32 * 4);
    }

    #[test]
    fn open_short_takes_only_size() {
        // openShort no longer trusts a caller-supplied spot print.
        let data = IDealerVault::openShortCall {
            size: U256::from(1),
        }
        .abi_encode();
        assert_eq!(data.len(), 36);
    }
}
