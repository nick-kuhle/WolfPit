// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Base} from "./ERC20Base.sol";

/// @notice Owner-mintable standard ERC-20 for TEST/Sepolia deployments.
///
///         Replaces `MockERC20` in the `Deployer` (WP-08 / #9): a production
///         deploy path must not instantiate a type named "Mock", and the token
///         must emit standard `Transfer` / `Approval` events so explorers,
///         wallets, indexers and exchange deposit crediting work at all.
///
///         TEST ONLY — do not fund. The Base mainnet launch shape
///         (`script/DeployBase.s.sol`) deploys no token at all.
contract TestERC20 is ERC20Base {
    address public owner;

    error NotOwner();
    error Zero();

    event OwnerSet(address indexed previous, address indexed next);

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20Base(name_, symbol_, decimals_)
    {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setOwner(address next) external onlyOwner {
        if (next == address(0)) revert Zero();
        emit OwnerSet(owner, next);
        owner = next;
    }

    /// @notice Owner-gated mint — unlike the test fixture, there is no
    ///         ungated issuance path here.
    function mint(address to, uint256 amt) external onlyOwner {
        _mint(to, amt);
    }
}
