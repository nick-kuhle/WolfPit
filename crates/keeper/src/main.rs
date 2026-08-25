//! WolfPit keeper — Alloy 2.x.
//! Dry-run encodes vault calls. With RPC, reads cover and insurance.

use alloy::primitives::{Address, U256};
use alloy::sol;
use alloy::sol_types::SolCall;
use clap::Parser;
use eyre::Result;

sol! {
    #[sol(rpc)]
    interface IDealerVault {
        function paused() external view returns (bool);
        function reservedEth() external view returns (uint256);
        function ethBal() external view returns (uint256);
        function usdcBal() external view returns (uint256);
        function insuranceUsdc() external view returns (uint256);
        function utilBps() external view returns (uint256);
        function haltShortGamma(uint256 spot) external view returns (bool);
        function pause(bool v) external;
        function writeCall(uint256 size) external;
    }
}

#[derive(Parser, Debug)]
#[command(name = "wolfpit-keeper", about = "Alloy keeper for the WolfPit TEST vault")]
struct Args {
    /// HTTP RPC. If empty, dry-run calldata only.
    #[arg(long, env = "WOLFPIT_RPC")]
    rpc: Option<String>,
    #[arg(long, env = "WOLFPIT_VAULT")]
    vault: Option<Address>,
    /// ETH/USDC mark in 6-decimal USDC per 1e18 ETH (e.g. 4000e6).
    #[arg(long, default_value = "4000000000")]
    spot: U256,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let pause_cd = IDealerVault::pauseCall { v: true }.abi_encode();
    let write_cd = IDealerVault::writeCallCall {
        size: U256::from(1_000_000_000_000_000_000u128),
    }
    .abi_encode();
    println!("wolfpit-keeper alloy");
    println!("pause calldata: 0x{}", to_hex(&pause_cd));
    println!("writeCall(1 ETH) calldata: 0x{}", to_hex(&write_cd));

    if let (Some(rpc), Some(vault)) = (args.rpc, args.vault) {
        let provider = alloy::providers::ProviderBuilder::new().connect_http(rpc.parse()?);
        let c = IDealerVault::new(vault, provider);
        let paused = c.paused().call().await?;
        let reserved = c.reservedEth().call().await?;
        let eth = c.ethBal().call().await?;
        let ins = c.insuranceUsdc().call().await?;
        let halt = c.haltShortGamma(args.spot).call().await?;
        println!("vault {vault} rpc {rpc}");
        println!("paused={paused} reservedEth={reserved} ethBal={eth} insurance={ins} haltShortGamma={halt}");
        if halt {
            println!("halt: do not write gamma");
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
}
