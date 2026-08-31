// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Deployer} from "../src/Deployer.sol";
import {WPIT} from "../src/WPIT.sol";

interface Vm {
    function prank(address) external;
}

contract DeployerTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    /// B2 regression: the token-era deploy must actually work — pre-fix the
    ///        whole constructor path reverted NotOwner() (Deployer called the
    ///        owner-gated vault.setWpitFeeder while the vault's owner was the
    ///        external deployer), and even past that, vault.setStake was never
    ///        wired, so slashInsuranceJunior always reverted Zero(). Post-fix,
    ///        Deployer wires everything as owner, then hands ownership back
    ///        (vault.acceptOwnership) and the full stake→slash loop works.
    function testDeployerWiresStakeAndSlashPath() public {
        Deployer d = new Deployer(true);
        d.vault().acceptOwnership(); // completes the two-step handoff
        require(d.vault().owner() == address(this), "deployer is the vault owner");
        require(d.vault().stake() == address(d.stake()), "Deployer wires vault.setStake");
        // Mint WPIT through the real wiring: the farm is the current minter,
        // so it hands the key over, then we stake into the deployed Stake
        // contract and slash through the deployed vault — the full loop.
        // (Hold the WPIT ref in a local: the prank applies to the next call
        // only, and a `d.wpit()` getter would consume it.)
        WPIT wpit = d.wpit();
        vm.prank(address(d.farm()));
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 50 ether);
        wpit.approve(address(d.stake()), type(uint256).max);
        d.stake().stake(50 ether);
        d.vault().slashInsuranceJunior(20 ether);
        require(d.vault().insuranceWpit() == 20 ether, "junior slash credited to insurance");
        require(d.stake().total() == 30 ether, "stake pool reduced by the slash");
        require(d.wpit().balanceOf(address(d.vault())) == 20 ether, "WPIT moved into the vault");
    }

    /// The launch shape (withWpit = false) must stay vault-only: no token-era
    ///        contracts, and the slash is unreachable by design (Zero()).
    function testLaunchShapeHasNoTokenEra() public {
        Deployer d = new Deployer(false);
        d.vault().acceptOwnership(); // completes the two-step handoff
        require(address(d.wpit()) == address(0), "no WPIT at launch");
        require(address(d.farm()) == address(0), "no farm at launch");
        require(address(d.stake()) == address(0), "no stake at launch");
        require(d.vault().stake() == address(0), "no stake wired at launch");
        try d.vault().slashInsuranceJunior(1 ether) {
            revert("expected Zero: no stake at launch");
        } catch {}
    }
}
