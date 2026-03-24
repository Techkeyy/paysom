// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SomniaEventHandler.sol";

/**
 * @title PaySom
 * @notice Trustless freelance escrow powered by Somnia Reactivity.
 *
 * THE PROBLEM:
 *   Freelancers get scammed. Clients pay late or not at all.
 *   Platforms like Upwork charge 20% and still fail to protect both sides.
 *
 * THE SOLUTION:
 *   PaySom uses Somnia's on-chain Reactivity to create a self-executing
 *   escrow. The chain itself acts as the trustless intermediary:
 *
 *   1. Client creates escrow + deposits RSTT tokens
 *   2. Reactivity detects the Transfer event → _onEvent confirms funding
 *   3. Freelancer delivers work → posts hash on-chain
 *   4. Reactivity detects WorkDelivered → _onEvent auto-releases payment
 *   5. If client disputes within the window → arbitrator resolves
 *
 *   NO UPWORK. NO PAYPAL. NO 20% FEES. NO TRUST REQUIRED.
 *
 * DEPLOY:
 *   1. Deploy MockSTT.sol → copy address
 *   2. Deploy PaySom.sol with MockSTT address as constructor arg
 *   3. Run subscribe.ts to register Reactivity subscriptions
 */
contract PaySom is SomniaEventHandler {

    // ── Types ─────────────────────────────────────────────────────────────────

    enum EscrowState {
        Pending,    // Created, awaiting token deposit
        Funded,     // Tokens received — Reactivity confirmed this ⚡
        Delivered,  // Freelancer submitted work hash
        Released,   // Payment auto-released by Reactivity ⚡
        Disputed,   // Client raised a dispute
        Refunded    // Resolved in client's favour
    }

    struct Escrow {
        uint256     id;
        address     client;
        address     freelancer;
        uint256     amount;
        string      title;          // Job title for display
        bytes32     deliveryHash;   // keccak256 of deliverable (IPFS CID etc.)
        EscrowState state;
        uint256     createdBlock;
        uint256     fundedBlock;
        uint256     deliveredBlock;
        uint256     disputeWindow;  // blocks client has to dispute after delivery
    }

    // ── State ─────────────────────────────────────────────────────────────────

    address public immutable token;
    address public           arbitrator;
    uint256 public           escrowCount;
    uint256 public constant  DEFAULT_DISPUTE_WINDOW = 300;

    mapping(uint256 => Escrow)    public escrows;
    mapping(address => uint256[]) public clientEscrows;
    mapping(address => uint256[]) public freelancerEscrows;
    mapping(uint256 => bool)      public paymentConfirmed;

    // ── Event signatures ──────────────────────────────────────────────────────

    // keccak256("Transfer(address,address,uint256)")
    bytes32 constant TRANSFER_SIG =
        0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    // keccak256("WorkDelivered(uint256,address,bytes32)")
    bytes32 constant WORK_DELIVERED_SIG =
        keccak256("WorkDelivered(uint256,address,bytes32)");

    // ── Events ────────────────────────────────────────────────────────────────

    event EscrowCreated(
        uint256 indexed id,
        address indexed client,
        address indexed freelancer,
        uint256 amount,
        string title
    );
    event PaymentConfirmed(uint256 indexed id, uint256 blockNumber);
    event WorkDelivered(uint256 indexed id, address indexed freelancer, bytes32 deliveryHash);
    event PaymentReleased(uint256 indexed id, address indexed freelancer, uint256 amount);
    event DisputeRaised(uint256 indexed id, address indexed client);
    event DisputeResolved(uint256 indexed id, address winner, uint256 amount);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _token) {
        token      = _token;
        arbitrator = msg.sender;
    }

    // ── Client: Create & fund escrow ──────────────────────────────────────────

    /**
     * @notice Creates escrow and immediately transfers tokens into the contract.
     * @dev Requires prior approval: token.approve(address(this), amount)
     *      The Transfer event from transferFrom triggers Reactivity →
     *      _onEvent confirms the escrow as Funded automatically.
     */
    function createEscrow(
        address freelancer,
        uint256 amount,
        string calldata title,
        uint256 disputeWindow
    ) external returns (uint256 escrowId) {
        require(freelancer != address(0), "Invalid freelancer");
        require(freelancer != msg.sender, "Cannot escrow to yourself");
        require(amount > 0,               "Amount must be > 0");
        require(bytes(title).length > 0,  "Title required");

        escrowId = ++escrowCount;

        escrows[escrowId] = Escrow({
            id:             escrowId,
            client:         msg.sender,
            freelancer:     freelancer,
            amount:         amount,
            title:          title,
            deliveryHash:   bytes32(0),
            state:          EscrowState.Pending,
            createdBlock:   block.number,
            fundedBlock:    0,
            deliveredBlock: 0,
            disputeWindow:  disputeWindow > 0 ? disputeWindow : DEFAULT_DISPUTE_WINDOW
        });

        clientEscrows[msg.sender].push(escrowId);
        freelancerEscrows[freelancer].push(escrowId);

        emit EscrowCreated(escrowId, msg.sender, freelancer, amount, title);

        // This transferFrom emits Transfer(client, this, amount)
        // Reactivity subscribes to this → _onEvent fires → Funded state set
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(ok, "Token transfer failed — did you approve first?");
    }

    // ── Freelancer: Deliver work ──────────────────────────────────────────────

    /**
     * @notice Freelancer marks work as delivered by posting a delivery hash.
     * @dev deliveryHash = keccak256 of work content / IPFS CID / file hash
     *      Emits WorkDelivered → Reactivity detects it → _onEvent auto-releases payment
     */
    function deliverWork(uint256 escrowId, bytes32 deliveryHash) external {
        Escrow storage e = escrows[escrowId];
        require(msg.sender == e.freelancer,     "Not the freelancer");
        require(e.state == EscrowState.Funded,  "Escrow not funded yet");
        require(deliveryHash != bytes32(0),      "Invalid delivery hash");

        e.deliveryHash    = deliveryHash;
        e.state           = EscrowState.Delivered;
        e.deliveredBlock  = block.number;

        // This event triggers Reactivity → _onEvent → PaymentReleased ⚡
        emit WorkDelivered(escrowId, msg.sender, deliveryHash);
    }

    // ── Client: Raise dispute ─────────────────────────────────────────────────

    function raiseDispute(uint256 escrowId) external {
        Escrow storage e = escrows[escrowId];
        require(msg.sender == e.client,                             "Not the client");
        require(e.state == EscrowState.Delivered,                   "Not in Delivered state");
        require(block.number <= e.deliveredBlock + e.disputeWindow, "Dispute window closed");

        e.state = EscrowState.Disputed;
        emit DisputeRaised(escrowId, msg.sender);
    }

    // ── Arbitrator: Resolve dispute ───────────────────────────────────────────

    function resolveDispute(uint256 escrowId, bool favourFreelancer) external {
        require(msg.sender == arbitrator,        "Not arbitrator");
        Escrow storage e = escrows[escrowId];
        require(e.state == EscrowState.Disputed, "Not disputed");

        address winner = favourFreelancer ? e.freelancer : e.client;
        e.state = favourFreelancer ? EscrowState.Released : EscrowState.Refunded;

        IERC20(token).transfer(winner, e.amount);
        emit DisputeResolved(escrowId, winner, e.amount);
    }

    // ── Somnia Reactivity: _onEvent ───────────────────────────────────────────

    /**
     * @notice THE CORE OF PAYSOM — called by Somnia validators automatically.
     *
     *  Subscription 1 (emitter = MockSTT):
     *    Fires when RSTT tokens transfer INTO this contract.
     *    Action: find matching Pending escrow → mark as Funded
     *
     *  Subscription 2 (emitter = this contract):
     *    Fires when freelancer calls deliverWork() → WorkDelivered emitted.
     *    Action: auto-release payment to freelancer in the SAME BLOCK
     *
     *  Zero backend. Zero bots. Zero trust. The chain does it all.
     */
    function _onEvent(
        address emitter,
        bytes32[] calldata topics,
        bytes calldata data
    ) internal override {
        if (topics.length == 0) return;

        bytes32 sig = topics[0];

        // ── RSTT Transfer → confirm escrow funding ────────────────────────────
        if (sig == TRANSFER_SIG && emitter == token) {
            if (topics.length < 3) return;

            address from = address(uint160(uint256(topics[1]))); // sender of tokens
            address to   = address(uint160(uint256(topics[2])));
            if (to != address(this)) return;

            uint256 amount = abi.decode(data, (uint256));

            // Match to a Pending escrow by client address and amount
            for (uint256 i = 1; i <= escrowCount; i++) {
                Escrow storage e = escrows[i];
                if (
                    e.state  == EscrowState.Pending &&
                    e.client == from                 &&
                    e.amount == amount               &&
                    !paymentConfirmed[i]
                ) {
                    paymentConfirmed[i] = true;
                    e.state             = EscrowState.Funded;
                    e.fundedBlock       = block.number;
                    emit PaymentConfirmed(i, block.number);
                    break;
                }
            }
            return;
        }

        // ── WorkDelivered → auto-release payment ──────────────────────────────
        if (sig == WORK_DELIVERED_SIG && emitter == address(this)) {
            if (topics.length < 2) return;

            uint256 escrowId = uint256(topics[1]);
            Escrow storage e = escrows[escrowId];

            if (e.state != EscrowState.Delivered) return;

            e.state = EscrowState.Released;
            IERC20(token).transfer(e.freelancer, e.amount);
            emit PaymentReleased(escrowId, e.freelancer, e.amount);
        }
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getEscrow(uint256 id) external view returns (Escrow memory) {
        return escrows[id];
    }

    function getClientEscrows(address client) external view returns (uint256[] memory) {
        return clientEscrows[client];
    }

    function getFreelancerEscrows(address addr) external view returns (uint256[] memory) {
        return freelancerEscrows[addr];
    }

    function getAllEscrows() external view returns (Escrow[] memory) {
        Escrow[] memory all = new Escrow[](escrowCount);
        for (uint256 i = 0; i < escrowCount; i++) {
            all[i] = escrows[i + 1];
        }
        return all;
    }
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
