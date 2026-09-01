// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./DealerVault.sol";
import {IERC20 as OzIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20 as OzSafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Safe ERC-20 wrapper (WP-09 / #10), delegating to OpenZeppelin (#4).
///
///         `SimplePair`, `Stake` and `DealerVault` used to discard the boolean
///         returned by every `transfer` / `transferFrom` / `approve`. Against a
///         real-world token that is a silent failure path: a transfer that
///         returns `false` credits a deposit that never arrived.
///
///         The first fix was a hand-rolled wrapper. Issue #4 asked for a
///         reviewed, audited implementation instead, so the bodies below now
///         delegate to the OpenZeppelin `SafeERC20` (imported above as
///         `OzSafeERC20`). This file survives only as the ADAPTER between the
///         vault's local `IERC20` (declared in DealerVault.sol, so the vault
///         stays dependency-light at its interface) and OZ's `IERC20` — no call
///         site changed when the implementation moved.
///
///         OZ's semantics are the ones now in force, and they are stricter than
///         the hand-rolled version in the way that matters: a `false` return
///         reverts, a reverted call reverts, and a call to an address with no
///         code reverts. The USDT-style "returns no data" case is handled by OZ
///         by checking that the target has code before requiring return data.
///
///         Fee-on-transfer / rebasing tokens are still NOT supported: callers
///         that book a reserve from an assumed amount must measure the delta
///         instead. That is what `DealerVault.openShort` does, and it is the
///         pattern the rest of the contracts should follow.
library SafeERC20 {
    /// @dev The local IERC20 and OZ's IERC20 declare identical function
    ///      signatures and therefore identical selectors, so this cast changes
    ///      only the Solidity type, never the emitted calldata.
    function _oz(IERC20 token) private pure returns (OzIERC20) {
        return OzIERC20(address(token));
    }

    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        OzSafeERC20.safeTransfer(_oz(token), to, value);
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        OzSafeERC20.safeTransferFrom(_oz(token), from, to, value);
    }

    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        OzSafeERC20.forceApprove(_oz(token), spender, value);
    }
}
