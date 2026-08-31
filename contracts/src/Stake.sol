// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WPIT} from "./WPIT.sol";
import {DealerVault} from "./DealerVault.sol";

/// @notice First-loss junior. Slash order: insurance USDC → staked WPIT → pause → LP NAV.
///         FARM.md: production runs a 7-day unstake cooldown so a slashed
///         tranche cannot be exited before the vault draws on it. The TEST
///         default is 0 (instant) — `setCooldown` by the owner flips it.
contract Stake {
    WPIT public immutable wpit;
    DealerVault public immutable vault;
    address public owner;
    /// @notice Seconds a stake must stay before it can be unstaked (0 = instant).
    uint256 public cooldown;
    mapping(address => uint256) public staked;
    /// @notice Earliest timestamp a user may unstake (now + cooldown at stake).
    mapping(address => uint256) public unstakeAt;
    uint256 public total;

    error NotOwner();
    error Cooldown();

    event OwnerSet(address indexed previous, address indexed next);
    event CooldownSet(uint256 cooldown);
    event Staked(address indexed who, uint256 amt);
    event Unstaked(address indexed who, uint256 amt);
    event Slashed(uint256 amt);

    constructor(WPIT wpit_, DealerVault vault_) {
        wpit = wpit_;
        vault = vault_;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setOwner(address next) external onlyOwner {
        emit OwnerSet(owner, next);
        owner = next;
    }

    function setCooldown(uint256 secs) external onlyOwner {
        cooldown = secs;
        emit CooldownSet(secs);
    }

    function stake(uint256 amt) external {
        wpit.transferFrom(msg.sender, address(this), amt);
        staked[msg.sender] += amt;
        total += amt;
        // Every new stake extends the lock (no top-up-and-dump).
        unstakeAt[msg.sender] = block.timestamp + cooldown;
        emit Staked(msg.sender, amt);
    }

    function unstake(uint256 amt) external {
        if (block.timestamp < unstakeAt[msg.sender]) revert Cooldown();
        require(staked[msg.sender] >= amt, "bal");
        staked[msg.sender] -= amt;
        total -= amt;
        wpit.transfer(msg.sender, amt);
        emit Unstaked(msg.sender, amt);
    }

    /// @notice Vault-only junior slash. Returns the amount actually taken
    ///         (capped at `total`).
    function slash(uint256 amt) external returns (uint256) {
        require(msg.sender == address(vault), "vault");
        if (amt > total) amt = total;
        total -= amt;
        wpit.transfer(address(vault), amt);
        emit Slashed(amt);
        return amt;
    }
}
