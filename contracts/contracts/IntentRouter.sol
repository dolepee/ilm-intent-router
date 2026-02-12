// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal ERC20 interface for escrow transfers.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title IntentRouter (ILM MVP)
/// @notice Users post intents with constraints; approved solver executes and settles.
///         Real ERC20 escrow, token transfers on fill/cancel/expire.
contract IntentRouter {
    // Reentrancy guard (lightweight, no OZ import)
    bool private _locked;

    modifier nonReentrant() {
        require(!_locked, "reentrant");
        _locked = true;
        _;
        _locked = false;
    }

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
    error TransferFailed();

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

    /// @notice Post an intent and escrow amountIn of tokenIn into the contract.
    function createIntent(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 maxSlippageBps,
        uint256 maxGasWei,
        uint64 deadline
    ) external nonReentrant returns (uint256 intentId) {
        if (amountIn == 0 || minAmountOut == 0) revert InvalidIntent();
        if (deadline <= block.timestamp) revert InvalidIntent();
        if (maxSlippageBps > 10_000) revert InvalidIntent();

        bool ok = IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        if (!ok) revert TransferFailed();

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

        emit IntentCreated(intentId, msg.sender, tokenIn, tokenOut, amountIn, minAmountOut, deadline);
    }

    /// @notice Solver fills an open intent with real token transfers.
    function fillIntent(
        uint256 intentId,
        uint256 amountOut,
        bytes32 executionHash
    ) external nonReentrant {
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
        uint256 userAmount = amountOut - fee;

        bool ok1 = IERC20(inx.tokenOut).transferFrom(msg.sender, address(this), amountOut);
        if (!ok1) revert TransferFailed();

        bool ok2 = IERC20(inx.tokenOut).transfer(inx.user, userAmount);
        if (!ok2) revert TransferFailed();

        if (fee > 0) {
            bool ok3 = IERC20(inx.tokenOut).transfer(feeRecipient, fee);
            if (!ok3) revert TransferFailed();
        }

        bool ok4 = IERC20(inx.tokenIn).transfer(msg.sender, inx.amountIn);
        if (!ok4) revert TransferFailed();

        emit IntentFilled(intentId, msg.sender, amountOut, executionHash, fee);
    }

    /// @notice User cancels their open intent and reclaims escrowed tokenIn.
    function cancelIntent(uint256 intentId) external nonReentrant {
        Intent storage inx = intents[intentId];
        if (inx.user != msg.sender) revert NotIntentOwner();
        if (inx.status != IntentStatus.Open) revert InvalidStatus();

        inx.status = IntentStatus.Cancelled;

        bool ok = IERC20(inx.tokenIn).transfer(inx.user, inx.amountIn);
        if (!ok) revert TransferFailed();

        emit IntentCancelled(intentId);
    }

    /// @notice Anyone can mark an intent as expired after deadline; escrowed tokenIn returns to user.
    function markExpired(uint256 intentId) external nonReentrant {
        Intent storage inx = intents[intentId];
        if (inx.status != IntentStatus.Open) revert InvalidStatus();
        if (block.timestamp <= inx.deadline) revert InvalidIntent();

        inx.status = IntentStatus.Expired;

        bool ok = IERC20(inx.tokenIn).transfer(inx.user, inx.amountIn);
        if (!ok) revert TransferFailed();
    }
}
