// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IntentRouter (ILM MVP)
/// @notice Users post intents with constraints; approved solver executes and settles.
contract IntentRouter {
    enum IntentStatus {
        Open,
        Filled,
        Cancelled,
        Expired
    }

    struct Intent {
        address user;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 maxSlippageBps;
        uint256 maxGasWei;
        uint64 deadline;
        IntentStatus status;
        address winningSolver;
        uint256 amountOut;
        bytes32 executionHash;
    }

    uint256 public nextIntentId = 1;
    uint256 public protocolFeeBps = 10; // 0.10%
    address public feeRecipient;
    address public owner;

    mapping(uint256 => Intent) public intents;
    mapping(address => bool) public approvedSolvers;

    event IntentCreated(
        uint256 indexed intentId,
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint64 deadline
    );

    event IntentFilled(
        uint256 indexed intentId,
        address indexed solver,
        uint256 amountOut,
        bytes32 executionHash,
        uint256 feePaid
    );

    event IntentCancelled(uint256 indexed intentId);
    event SolverApproved(address indexed solver, bool approved);
    event ProtocolFeeUpdated(uint256 bps);
    event FeeRecipientUpdated(address indexed newRecipient);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    error NotOwner();
    error NotIntentOwner();
    error InvalidIntent();
    error InvalidStatus();
    error DeadlinePassed();
    error SolverNotApproved();
    error OutputTooLow();

    constructor(address _feeRecipient) {
        owner = msg.sender;
        feeRecipient = _feeRecipient;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setSolver(address solver, bool approved) external onlyOwner {
        approvedSolvers[solver] = approved;
        emit SolverApproved(solver, approved);
    }

    function setProtocolFeeBps(uint256 bps) external onlyOwner {
        require(bps <= 100, "fee too high");
        protocolFeeBps = bps;
        emit ProtocolFeeUpdated(bps);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "zero recipient");
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(newRecipient);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    function createIntent(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 maxSlippageBps,
        uint256 maxGasWei,
        uint64 deadline
    ) external payable returns (uint256 intentId) {
        if (amountIn == 0 || minAmountOut == 0) revert InvalidIntent();
        if (deadline <= block.timestamp) revert InvalidIntent();
        if (maxSlippageBps > 10_000) revert InvalidIntent();

        intentId = nextIntentId++;
        intents[intentId] = Intent({
            user: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            maxSlippageBps: maxSlippageBps,
            maxGasWei: maxGasWei,
            deadline: deadline,
            status: IntentStatus.Open,
            winningSolver: address(0),
            amountOut: 0,
            executionHash: bytes32(0)
        });

        emit IntentCreated(
            intentId,
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            deadline
        );
    }

    /// @notice In MVP, solver provides output and proof hash; actual swap execution remains offchain for demo.
    function fillIntent(
        uint256 intentId,
        uint256 amountOut,
        bytes32 executionHash
    ) external {
        if (!approvedSolvers[msg.sender]) revert SolverNotApproved();

        Intent storage inx = intents[intentId];
        if (inx.status != IntentStatus.Open) revert InvalidStatus();
        if (block.timestamp > inx.deadline) revert DeadlinePassed();
        if (amountOut < inx.minAmountOut) revert OutputTooLow();

        inx.status = IntentStatus.Filled;
        inx.winningSolver = msg.sender;
        inx.amountOut = amountOut;
        inx.executionHash = executionHash;

        uint256 fee = (amountOut * protocolFeeBps) / 10_000;

        emit IntentFilled(intentId, msg.sender, amountOut, executionHash, fee);
    }

    function cancelIntent(uint256 intentId) external {
        Intent storage inx = intents[intentId];
        if (inx.user != msg.sender) revert NotIntentOwner();
        if (inx.status != IntentStatus.Open) revert InvalidStatus();

        inx.status = IntentStatus.Cancelled;
        emit IntentCancelled(intentId);
    }

    function markExpired(uint256 intentId) external {
        Intent storage inx = intents[intentId];
        if (inx.status != IntentStatus.Open) revert InvalidStatus();
        if (block.timestamp <= inx.deadline) revert InvalidIntent();

        inx.status = IntentStatus.Expired;
    }
}
