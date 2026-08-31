// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./DealerVault.sol";

/// @notice Minimal SafeERC20 (WP-09 / #10).
///
///         `SimplePair`, `Stake` and `DealerVault` used to discard the boolean
///         returned by every `transfer` / `transferFrom` / `approve`. Against a
///         real-world token that is a silent failure path: a transfer that
///         returns `false` credits a deposit that never arrived.
///
///         Semantics, deliberately conservative:
///           - a `false` return ALWAYS reverts;
///           - a reverted call ALWAYS reverts (no low-level "ignore it");
///           - a token that returns NO data is tolerated only if the balance
///             actually moved (the USDT-style non-standard case), measured the
///             way `DealerVault.openShort` already measures swap proceeds;
///           - a call to an address with no code reverts.
///
///         Fee-on-transfer / rebasing tokens are still NOT supported: callers
///         that book a reserve from an assumed amount must measure the delta
///         instead. That is what `openShort` does, and it is the pattern the
///         rest of the contracts should follow.
library SafeERC20 {
    error SafeTransferFailed(address token);
    error SafeTransferFromFailed(address token);
    error SafeApproveFailed(address token);

    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        uint256 before = _balanceOf(token, to);
        (bool ok, bytes memory data) =
            address(token).call(abi.encodeCall(IERC20.transfer, (to, value)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool))) || _balanceOf(token, to) - before != value) {
            revert SafeTransferFailed(address(token));
        }
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        uint256 before = _balanceOf(token, to);
        (bool ok, bytes memory data) =
            address(token).call(abi.encodeCall(IERC20.transferFrom, (from, to, value)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool))) || _balanceOf(token, to) - before != value) {
            revert SafeTransferFromFailed(address(token));
        }
    }

    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        (bool ok, bytes memory data) =
            address(token).call(abi.encodeCall(IERC20.approve, (spender, value)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert SafeApproveFailed(address(token));
        }
    }

    function _balanceOf(IERC20 token, address who) private view returns (uint256) {
        return token.balanceOf(who);
    }
}
