// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SomniaEventHandler} from "reactivity/SomniaEventHandler.sol";
import {ISomniaReactivityPrecompile} from "reactivity/interfaces/ISomniaReactivityPrecompile.sol";
import {ISomniaEventHandler} from "reactivity/interfaces/ISomniaEventHandler.sol";
import {SomniaExtensions} from "reactivity/interfaces/SomniaExtensions.sol";

/// @title CallBook
/// @notice Public, uneditable record of trade calls. No owner, no admin, no upgrade,
///         and no function that modifies a call's terms after posting.
contract CallBook is SomniaEventHandler {
    struct Call {
        address caller;
        address pool; // dreamDEX PerpPool address the call is on
        bool isLong;
        uint64 postedAt; // block.timestamp
        uint64 expiresAt; // unix seconds; after this the card stops accepting takes (enforced in the app)
        uint64 closedAt; // 0 while open; set once by close()
        uint128 entry; // 18-decimal quote units (USDso), exactly as dreamDEX uses
        uint128 stop;
        uint128 target;
        string note; // the caller's thesis, <= 280 bytes
    }

    /// @dev One slot: 32 + 32 + 128 bits.
    struct Takes {
        uint32 fills;
        uint32 takers;
        uint128 fees;
    }

    event TakeRecorded(uint256 indexed id, address indexed taker, uint256 amount);

    event CallPosted(
        uint256 indexed id,
        address indexed caller,
        address indexed pool,
        bool isLong,
        uint128 entry,
        uint128 stop,
        uint128 target,
        uint64 expiresAt,
        string note
    );
    event CallClosed(uint256 indexed id, address indexed caller, uint64 closedAt);

    error ZeroPool();
    error BadPrices();
    error BadExpiry();
    error NoteTooLong();
    error NoSuchCall();
    error NotCaller();
    error AlreadyClosed();
    error AlreadyOpen();
    error AlreadyWatching();
    error NeedsBalance();

    uint256 private constant MAX_DURATION = 30 days;
    uint256 private constant MAX_NOTE_BYTES = 280;

    bytes32 private constant BUILDER_FEE_CHARGED = keccak256("BuilderFeeCharged(address,address,address,uint256)");

    address public immutable marginBank;
    uint256 public subscriptionId;
    bool private _watching;

    Call[] private _calls; // id = index + 1
    mapping(address => uint256[]) private _callsOf;
    mapping(address => mapping(address => uint256)) private _latest; // caller => pool => latest call id
    mapping(uint256 => Takes) private _takes;
    mapping(uint256 => mapping(address => bool)) private _taken;

    constructor(address marginBank_) {
        marginBank = marginBank_;
    }

    receive() external payable {}

    /// @notice Creates the single Reactivity subscription. Anyone may call; fund this contract with >= 32 STT.
    function watch() external payable {
        if (_watching) revert AlreadyWatching();
        if (address(this).balance < SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE) revert NeedsBalance();
        _watching = true;
        bytes32[4] memory topics;
        topics[0] = BUILDER_FEE_CHARGED;
        subscriptionId = ISomniaReactivityPrecompile(SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS).subscribe(
            ISomniaReactivityPrecompile.SubscriptionData({
                eventTopics: topics,
                origin: address(0),
                caller: address(0),
                emitter: marginBank,
                handlerContractAddress: address(this),
                handlerFunctionSelector: ISomniaEventHandler.onEvent.selector,
                priorityFeePerGas: 0,
                maxFeePerGas: 20 gwei,
                gasLimit: 3_000_000,
                isGuaranteed: true,
                isCoalesced: false
            })
        );
    }

    function _onEvent(address emitter, bytes32[] calldata topics, bytes calldata data) internal override {
        if (
            emitter != marginBank || topics.length < 4 || topics[0] != BUILDER_FEE_CHARGED || tx.origin != address(this)
                || data.length < 32
        ) return;
        address payer = address(uint160(uint256(topics[1])));
        uint256 id = openCallOf(address(uint160(uint256(topics[2]))), address(uint160(uint256(topics[3]))));
        if (id == 0) return;
        uint256 amount = abi.decode(data, (uint256));

        Takes memory t = _takes[id];
        t.fills += 1;
        t.fees += uint128(amount);
        if (!_taken[id][payer]) {
            _taken[id][payer] = true;
            t.takers += 1;
        }
        _takes[id] = t;
        emit TakeRecorded(id, payer, amount);
    }

    /// @notice The caller's open call on a pool (not closed, not expired), or 0.
    function openCallOf(address caller, address pool) public view returns (uint256 id) {
        id = _latest[caller][pool];
        if (id == 0) return 0;
        Call storage c = _calls[id - 1];
        if (c.closedAt != 0 || c.expiresAt <= block.timestamp) return 0;
    }

    function getTakes(uint256 id) external view returns (Takes memory) {
        if (id == 0 || id > _calls.length) revert NoSuchCall();
        return _takes[id];
    }

    function hasTaken(uint256 id, address taker) external view returns (bool) {
        return _taken[id][taker];
    }

    function post(
        address pool,
        bool isLong,
        uint128 entry,
        uint128 stop,
        uint128 target,
        uint64 expiresAt,
        string calldata note
    ) external returns (uint256 id) {
        if (pool == address(0)) revert ZeroPool();
        if (isLong ? !(stop > 0 && stop < entry && entry < target) : !(target > 0 && target < entry && entry < stop)) {
            revert BadPrices();
        }
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_DURATION) revert BadExpiry();
        if (bytes(note).length > MAX_NOTE_BYTES) revert NoteTooLong();
        if (openCallOf(msg.sender, pool) != 0) revert AlreadyOpen();

        _calls.push(
            Call({
                caller: msg.sender,
                pool: pool,
                isLong: isLong,
                postedAt: uint64(block.timestamp),
                expiresAt: expiresAt,
                closedAt: 0,
                entry: entry,
                stop: stop,
                target: target,
                note: note
            })
        );
        id = _calls.length;
        _callsOf[msg.sender].push(id);
        _latest[msg.sender][pool] = id;

        emit CallPosted(id, msg.sender, pool, isLong, entry, stop, target, expiresAt, note);
    }

    function close(uint256 id) external {
        if (id == 0 || id > _calls.length) revert NoSuchCall();
        Call storage c = _calls[id - 1];
        if (msg.sender != c.caller) revert NotCaller();
        if (c.closedAt != 0) revert AlreadyClosed();
        c.closedAt = uint64(block.timestamp);
        emit CallClosed(id, msg.sender, c.closedAt);
    }

    function getCall(uint256 id) external view returns (Call memory) {
        if (id == 0 || id > _calls.length) revert NoSuchCall();
        return _calls[id - 1];
    }

    function callCount() external view returns (uint256) {
        return _calls.length;
    }

    function callsOf(address caller) external view returns (uint256[] memory) {
        return _callsOf[caller];
    }
}
