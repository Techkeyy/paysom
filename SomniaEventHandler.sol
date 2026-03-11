// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SomniaEventHandler
 * @notice Base contract for Somnia Reactivity.
 *         Paste this in Remix at the path:
 *         contracts/SomniaEventHandler.sol
 *
 *         The Somnia Reactivity Precompile lives at address 0x0100.
 *         When a subscribed event fires, the precompile calls onEvent()
 *         which forwards to your _onEvent() implementation.
 */
abstract contract SomniaEventHandler {
    // Somnia Reactivity Precompile address — hardcoded by the protocol
    address constant REACTIVITY_PRECOMPILE = address(0x0100);

    /**
     * @notice Called by the Somnia Reactivity Precompile when a subscribed event fires.
     *         Do NOT call this directly — it's invoked by the chain itself.
     */
    function onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) external {
        require(msg.sender == REACTIVITY_PRECOMPILE, "Only Somnia Reactivity Precompile");
        _onEvent(emitter, eventTopics, data);
    }

    /**
     * @notice Override this in your contract to handle reactive events.
     * @param emitter      The contract that emitted the event
     * @param eventTopics  topics[0] = event sig, topics[1..n] = indexed params
     * @param data         ABI-encoded non-indexed event params
     */
    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal virtual;
}
