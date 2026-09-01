// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev forge-std-free console printing for scripts, mirroring
///      forge-std/console2's `_sendLogPayload` exactly: a raw STATICCALL to
///      the magic console address whose result is ignored.
///
///      The previous pattern — a hand-rolled Solidity `Console` interface
///      pointed at the same address — compiled fine but REVERTED at runtime
///      under both `forge script` and `forge test` (reproduced: high-level
///      calls to the codeless console address are not patched by forge; only
///      the assembly-style staticcall is). With printing at the END of the
///      deploy scripts, that meant the full deployment broadcast succeeded and
///      the script then reverted at the summary — funds spent, no VITE block
///      printed. Reaching for a printf must never be able to brick a launch.
address constant CONSOLE_ADDRESS = 0x000000000000000000636F6e736F6c652e6c6f67;

function consoleSend(bytes memory payload) {
    uint256 payloadLength = payload.length;
    address consoleAddress = CONSOLE_ADDRESS;
    /// @solidity memory-safe-assembly
    assembly {
        pop(staticcall(gas(), consoleAddress, add(payload, 32), payloadLength, 0, 0))
    }
}

function logLine(string memory message) {
    consoleSend(abi.encodeWithSignature("log(string)", message));
}

function logAddr(string memory label, address value) {
    consoleSend(abi.encodeWithSignature("log(string,address)", label, value));
}

function logUint(string memory label, uint256 value) {
    consoleSend(abi.encodeWithSignature("log(string,uint256)", label, value));
}
