// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WPIT} from "./WPIT.sol";
import {DealerVault} from "./DealerVault.sol";

/// @notice First-loss junior. Slash order: insurance USDC → staked WPIT → pause → LP NAV.
///         FARM.md: production runs a 7-day unstake cooldown so a slashed
///         tranche cannot be exited before the vault draws on it. The TEST
///         default is 0 (instant) — `setCooldown` by the owner flips it.
///
///         Accounting is share-based: a slash burns backing tokens (`total`)
///         but not shares, so every staker's redeemable balance falls
///         pro-rata. Without this, a slash would let the first unstaker exit
///         at full pre-slash size and brick everyone behind them.
contract Stake {
    WPIT public immutable wpit;
    DealerVault public immutable vault;
    address public owner;
    /// @notice Seconds a stake must stay before it can be unstaked (0 = instant).
    uint256 public cooldown;
    /// @dev Internal share ledger. `staked(who)` below converts to tokens.
    mapping(address => uint256) internal sharesOf;
    /// @dev Epoch the user's shares belong to; stale-epoch shares are worth 0.
    mapping(address => uint256) internal shareEpoch;
    /// @notice Earliest timestamp a user may unstake (now + cooldown at stake).
    mapping(address => uint256) public unstakeAt;
    /// @notice WPIT tokens currently backing all outstanding shares.
    uint256 public total;
    uint256 internal totalShares;
    /// @dev Bumped when the pool is drained to zero: all outstanding shares
    ///      from the previous epoch are worthless and are ignored, so a fresh
    ///      staker never shares the pool with wiped positions.
    uint256 internal epoch;

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

    /// @notice Redeemable WPIT for `who` (post-slash, pro-rata).
    function staked(address who) public view returns (uint256) {
        uint256 sh = shareEpoch[who] == epoch ? sharesOf[who] : 0;
        if (sh == 0 || totalShares == 0) return 0;
        return (sh * total) / totalShares;
    }

    /// @dev Zero out stale-epoch shares before any mutation.
    function _sync(address who) internal returns (uint256) {
        if (shareEpoch[who] != epoch) {
            sharesOf[who] = 0;
            shareEpoch[who] = epoch;
        }
        return sharesOf[who];
    }

    /// @dev If backing hits zero while shares remain (full slash or dust),
    ///      wipe the share ledger so the invariant totalShares > 0 ⇒ total > 0
    ///      holds and share pricing never divides by zero.
    function _wipeIfEmpty() internal {
        if (total == 0 && totalShares != 0) {
            totalShares = 0;
            epoch += 1;
        }
    }

    function stake(uint256 amt) external {
        wpit.transferFrom(msg.sender, address(this), amt);
        uint256 sh = _sync(msg.sender);
        // Invariant: totalShares > 0 ⇒ total > 0, so this never divides by 0.
        uint256 minted = totalShares == 0 ? amt : (amt * totalShares) / total;
        sharesOf[msg.sender] = sh + minted;
        totalShares += minted;
        total += amt;
        // Every new stake extends the lock (no top-up-and-dump).
        unstakeAt[msg.sender] = block.timestamp + cooldown;
        emit Staked(msg.sender, amt);
    }

    function unstake(uint256 amt) external {
        if (block.timestamp < unstakeAt[msg.sender]) revert Cooldown();
        uint256 sh = _sync(msg.sender);
        uint256 bal = totalShares == 0 ? 0 : (sh * total) / totalShares;
        require(bal >= amt, "bal");
        // Burn shares rounding UP so a withdrawal can never leave the pool
        // owing more tokens than it holds; a full exit burns every share.
        uint256 burn = amt == bal ? sh : (amt * totalShares + total - 1) / total;
        sharesOf[msg.sender] = sh - burn;
        totalShares -= burn;
        total -= amt;
        _wipeIfEmpty();
        wpit.transfer(msg.sender, amt);
        emit Unstaked(msg.sender, amt);
    }

    /// @notice Vault-only junior slash. Returns the amount actually taken
    ///         (capped at `total`). Shares are NOT reduced, so the loss lands
    ///         on every staker pro-rata instead of whoever unstakes last.
    function slash(uint256 amt) external returns (uint256) {
        require(msg.sender == address(vault), "vault");
        if (amt > total) amt = total;
        total -= amt;
        _wipeIfEmpty();
        wpit.transfer(address(vault), amt);
        emit Slashed(amt);
        return amt;
    }
}
