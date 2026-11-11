// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SomniaEventHandler} from "reactivity/SomniaEventHandler.sol";
import {ISomniaReactivityPrecompile} from "reactivity/interfaces/ISomniaReactivityPrecompile.sol";
import {ISomniaEventHandler} from "reactivity/interfaces/ISomniaEventHandler.sol";
import {SomniaExtensions} from "reactivity/interfaces/SomniaExtensions.sol";

interface IPerpPool {
    function tryGetMarkPrice() external view returns (bool ok, uint256 price);
}

interface IMarginBank {
    function isPerpPoolRegistered(address pool) external view returns (bool);
}

/// @title CallBook v4.1
/// @notice Public, uneditable record of bonded trade calls on dreamDEX perps. A call's terms never
///         change after posting. Every terminal state is settled against the market's mark price:
///         HIT returns the bond, STOPPED pays it to takers, EXPIRED forfeits it in proportion to how
///         far the price moved against the call. The spec, payoff table and dodges are in
///         docs/v4-mechanism.md.
contract CallBook is SomniaEventHandler {
    struct Call {
        address caller;
        address pool; // a dreamDEX PerpPool registered on the MarginBank
        bool isLong;
        uint64 postedAt;
        uint64 expiresAt; // unix seconds; the chain settles the call at this moment (Reactivity schedule)
        uint64 closedAt; // 0 while open; close() only stops new takes, never exposure
        uint128 entry; // 18-decimal quote units (USDso)
        uint128 stop;
        uint128 target;
        uint128 capacity; // follower notional the bond covers, 18-decimal quote units
        string note; // <= 280 bytes
    }

    struct Takes {
        uint32 fills;
        uint32 takers;
        uint128 fees; // builder fees paid on every credited fill, covered or not
        uint128 covered; // follower notional inside the capacity
    }

    enum Outcome {
        None,
        Hit,
        Stopped,
        Expired
    }

    struct Result {
        Outcome outcome;
        uint64 resolvedAt;
        uint128 price; // mark price used to settle
        uint128 bond;
        uint128 forfeit; // part of the bond that goes to takers (bond for STOPPED, pro rata for EXPIRED)
        uint128 claimedTotal;
    }

    struct Record {
        uint32 hits;
        uint32 stops;
        uint32 expired;
        uint32 expiredLosses; // expired with the price on the losing side: counted as a miss
    }

    struct Taker {
        uint128 fee;
        uint128 covered;
        bool seen;
    }

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
    event CallTerms(uint256 indexed id, uint128 capacity, uint128 bond, uint256 expirySubscription);
    event CallClosed(uint256 indexed id, address indexed caller, uint64 closedAt);
    event TakeRecorded(uint256 indexed id, address indexed taker, uint256 amount);
    event TakeOverCapacity(uint256 indexed id, address indexed taker, uint256 uncoveredNotional);
    event Resolved(uint256 indexed id, uint8 outcome, uint256 price);
    event Claimed(uint256 indexed id, address indexed who, uint256 amount);
    event ReserveWithdrawn(address indexed to, uint256 amount);

    error ZeroPool();
    error PoolNotRegistered();
    error BadPrices();
    error EntryOffMarket();
    error StopTooWide();
    error StopTooTight();
    error RewardBelowRisk();
    error BadExpiry();
    error NoteTooLong();
    error NoSuchCall();
    error NotCaller();
    error AlreadyClosed();
    error AlreadyOpen();
    error AlreadyWatching();
    error NeedsBalance();
    error BondTooSmall();
    error ZeroCapacity();
    error TransferFailed();
    error AlreadyResolved();
    error StalePrice();
    error NotResolvable();
    error NotClaimable();
    error AlreadyClaimed();
    error NothingToClaim();
    error Reentrancy();
    error NotSteward();

    uint256 private constant MAX_DURATION = 30 days;
    uint256 private constant MAX_NOTE_BYTES = 280;
    uint256 private constant BPS = 10_000;
    uint256 public constant MAX_STOP_BPS = 1_000; // stop within 10% of entry
    uint256 public constant MIN_STOP_BPS = 10; // stop at least 0.1% from entry
    uint256 public constant MAX_ENTRY_DRIFT_BPS = 50; // entry within 0.5% of the mark at post
    uint256 public constant BOND_BPS = 200; // bond >= 2% of capacity
    /// @dev The builder fee is 10 bps of notional, so notional = fee * 1000.
    uint256 public constant FEE_TO_NOTIONAL = 1_000;
    uint64 private constant SCHEDULE_GAS = 2_000_000;

    bytes32 private constant BUILDER_FEE_CHARGED = keccak256("BuilderFeeCharged(address,address,address,uint256)");
    bytes32 private constant SCHEDULE = keccak256("Schedule(uint256)");
    address private constant PRECOMPILE = SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS;

    address public immutable marginBank;
    address public immutable bondToken;
    uint128 public immutable minBond;
    address public immutable steward; // can only withdraw this contract's native STT reserve

    uint256 public subscriptionId;
    bool private _watching;
    uint256 private _lock = 1;

    Call[] private _calls; // id = index + 1
    mapping(address => uint256[]) private _callsOf;
    mapping(address => mapping(address => uint256)) private _latest; // caller => pool => latest call id
    mapping(uint256 => Takes) private _takes;
    mapping(uint256 => mapping(address => Taker)) private _takers;
    mapping(uint256 => Result) private _results;
    mapping(uint256 => mapping(address => bool)) private _claimed;
    mapping(address => Record) private _records;
    mapping(uint256 => uint256) private _scheduledCall; // schedule timestamp (ms) => call id
    mapping(uint256 => uint256) public expirySubscriptionOf; // call id => Reactivity schedule subscription (0 = none)

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address marginBank_, address bondToken_, uint128 minBond_, address steward_) {
        marginBank = marginBank_;
        bondToken = bondToken_;
        minBond = minBond_;
        steward = steward_;
    }

    receive() external payable {}

    // ------------------------------------------------------------------ Reactivity

    /// @notice Creates the builder-fee subscription. Anyone may call; fund this contract with >= 32 STT.
    function watch() external payable {
        if (_watching) revert AlreadyWatching();
        if (address(this).balance < SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE) revert NeedsBalance();
        _watching = true;
        bytes32[4] memory topics;
        topics[0] = BUILDER_FEE_CHARGED;
        subscriptionId = ISomniaReactivityPrecompile(PRECOMPILE).subscribe(
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
        if (topics.length == 0) return;
        // Scheduled system events have no originating transaction, so they are not gated on tx.origin.
        // That is safe: settling only happens when the rules allow and only once, so an extra or
        // duplicate trigger (even from someone else's subscription) cannot change any outcome.
        if (emitter == PRECOMPILE && topics[0] == SCHEDULE && topics.length >= 2) {
            uint256 id = _scheduledCall[uint256(topics[1])];
            if (id != 0 && _results[id].outcome == Outcome.None) _settle(id, false);
            return;
        }
        // Builder-fee takes ARE gated on tx.origin == this (our own subscription), so a second
        // subscription delivering the same log cannot count a take twice.
        if (tx.origin != address(this)) return;
        if (emitter != marginBank || topics.length < 4 || topics[0] != BUILDER_FEE_CHARGED || data.length < 32) return;
        address payer = address(uint160(uint256(topics[1])));
        uint256 id = openCallOf(address(uint160(uint256(topics[2]))), address(uint160(uint256(topics[3]))));
        if (id == 0) return;
        uint256 amount = abi.decode(data, (uint256));

        uint256 notional = amount * FEE_TO_NOTIONAL;
        Takes memory t = _takes[id];
        Taker memory k = _takers[id][payer];
        uint256 cap = _calls[id - 1].capacity;
        uint256 room = cap > t.covered ? cap - t.covered : 0;
        uint256 credit = notional < room ? notional : room;

        t.fills += 1;
        t.fees += uint128(amount);
        t.covered += uint128(credit);
        k.fee += uint128(amount);
        k.covered += uint128(credit);
        if (!k.seen) {
            k.seen = true;
            t.takers += 1;
        }
        _takes[id] = t;
        _takers[id][payer] = k;
        emit TakeRecorded(id, payer, amount);
        if (credit < notional) emit TakeOverCapacity(id, payer, notional - credit);
    }

    /// @dev Best effort: a call is still valid if the schedule cannot be created (resolve stays permissionless).
    function _scheduleExpiry(uint256 id, uint64 expiresAt) private returns (uint256 sub) {
        if (address(this).balance < SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE) return 0;
        uint256 ms = uint256(expiresAt) * 1000 + (id % 1000); // unique per call within a second
        bytes32[4] memory topics;
        topics[0] = SCHEDULE;
        topics[1] = bytes32(ms);
        ISomniaReactivityPrecompile.SubscriptionData memory d = ISomniaReactivityPrecompile.SubscriptionData({
            eventTopics: topics,
            origin: address(0),
            caller: address(0),
            emitter: PRECOMPILE,
            handlerContractAddress: address(this),
            handlerFunctionSelector: ISomniaEventHandler.onEvent.selector,
            priorityFeePerGas: 1, // as in Somnia's schedule example
            maxFeePerGas: 20 gwei,
            gasLimit: SCHEDULE_GAS,
            isGuaranteed: false, // as SomniaExtensions.scheduleSubscriptionAtTimestamp builds it
            isCoalesced: false
        });
        (bool ok, bytes memory ret) = PRECOMPILE.call(abi.encodeCall(ISomniaReactivityPrecompile.subscribe, (d)));
        if (!ok || ret.length < 32) return 0;
        sub = abi.decode(ret, (uint256));
        _scheduledCall[ms] = id;
        expirySubscriptionOf[id] = sub;
    }

    // ------------------------------------------------------------------ post / close

    function post(
        address pool,
        bool isLong,
        uint128 entry,
        uint128 stop,
        uint128 target,
        uint64 expiresAt,
        string calldata note,
        uint128 capacity,
        uint128 bond
    ) external nonReentrant returns (uint256 id) {
        if (pool == address(0)) revert ZeroPool();
        if (!IMarginBank(marginBank).isPerpPoolRegistered(pool)) revert PoolNotRegistered();
        if (capacity == 0) revert ZeroCapacity();
        if (bond < minBond || uint256(bond) * BPS < uint256(capacity) * BOND_BPS) revert BondTooSmall();
        if (expiresAt <= block.timestamp + 1 || expiresAt > block.timestamp + MAX_DURATION) revert BadExpiry();
        if (bytes(note).length > MAX_NOTE_BYTES) revert NoteTooLong();
        if (openCallOf(msg.sender, pool) != 0) revert AlreadyOpen();
        _checkLevels(pool, isLong, entry, stop, target);

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
                capacity: capacity,
                note: note
            })
        );
        id = _calls.length;
        _callsOf[msg.sender].push(id);
        _latest[msg.sender][pool] = id;
        _results[id].bond = bond;

        _pull(msg.sender, bond);
        uint256 sub = _scheduleExpiry(id, expiresAt);
        emit CallPosted(id, msg.sender, pool, isLong, entry, stop, target, expiresAt, note);
        emit CallTerms(id, capacity, bond, sub);
    }

    function _checkLevels(address pool, bool isLong, uint256 entry, uint256 stop, uint256 target) private view {
        (bool ok, uint256 mark) = IPerpPool(pool).tryGetMarkPrice();
        if (!ok || mark == 0) revert StalePrice();
        uint256 risk;
        uint256 reward;
        if (isLong) {
            if (!(stop > 0 && stop < entry && entry < target && stop < mark && mark < target)) revert BadPrices();
            risk = entry - stop;
            reward = target - entry;
        } else {
            if (!(target > 0 && target < entry && entry < stop && target < mark && mark < stop)) revert BadPrices();
            risk = stop - entry;
            reward = entry - target;
        }
        uint256 drift = entry > mark ? entry - mark : mark - entry;
        if (drift * BPS > mark * MAX_ENTRY_DRIFT_BPS) revert EntryOffMarket();
        if (risk * BPS > entry * MAX_STOP_BPS) revert StopTooWide();
        if (risk * BPS < entry * MIN_STOP_BPS) revert StopTooTight();
        if (reward < risk) revert RewardBelowRisk();
    }

    /// @notice Stops new takes. Exposure (and the bond) still follow the market until resolution.
    function close(uint256 id) external {
        if (id == 0 || id > _calls.length) revert NoSuchCall();
        Call storage c = _calls[id - 1];
        if (msg.sender != c.caller) revert NotCaller();
        if (c.closedAt != 0) revert AlreadyClosed();
        c.closedAt = uint64(block.timestamp);
        emit CallClosed(id, msg.sender, c.closedAt);
    }

    // ------------------------------------------------------------------ resolve / claim

    /// @notice Permissionless. Settles a call against the pool's mark price, price before clock.
    function resolve(uint256 id) external nonReentrant {
        if (id == 0 || id > _calls.length) revert NoSuchCall();
        if (_results[id].outcome != Outcome.None) revert AlreadyResolved();
        _settle(id, true);
    }

    /// @dev strict: revert on failure (external resolve); otherwise return false (callback, claim).
    function _settle(uint256 id, bool strict) private returns (bool) {
        Call storage c = _calls[id - 1];
        Result storage r = _results[id];
        (bool ok, uint256 price) = _mark(c.pool);
        if (!ok) {
            if (strict) revert StalePrice();
            return false;
        }
        bool pastTarget = c.isLong ? price >= c.target : price <= c.target;
        bool pastStop = c.isLong ? price <= c.stop : price >= c.stop;
        bool expired = block.timestamp >= c.expiresAt;

        Outcome o;
        uint256 forfeit;
        if (pastStop) {
            o = Outcome.Stopped;
            forfeit = r.bond;
        } else if (pastTarget) {
            o = Outcome.Hit;
        } else if (expired) {
            o = Outcome.Expired;
            uint256 risk = c.isLong ? c.entry - c.stop : c.stop - c.entry;
            uint256 adverse = c.isLong ? (price < c.entry ? c.entry - price : 0) : (price > c.entry ? price - c.entry : 0);
            forfeit = uint256(r.bond) * adverse / risk; // adverse < risk here, so forfeit < bond
        } else {
            if (strict) revert NotResolvable();
            return false;
        }

        r.outcome = o;
        r.resolvedAt = uint64(block.timestamp);
        r.price = uint128(price);
        r.forfeit = uint128(forfeit);

        Record storage rec = _records[c.caller];
        if (o == Outcome.Hit) rec.hits++;
        else if (o == Outcome.Stopped) rec.stops++;
        else {
            rec.expired++;
            if (forfeit > 0) rec.expiredLosses++;
        }
        emit Resolved(id, uint8(o), price);
        return true;
    }

    function _mark(address pool) private view returns (bool ok, uint256 price) {
        (bool success, bytes memory ret) = pool.staticcall(abi.encodeCall(IPerpPool.tryGetMarkPrice, ()));
        if (!success || ret.length < 64) return (false, 0);
        (ok, price) = abi.decode(ret, (bool, uint256));
        if (price == 0) ok = false;
    }

    /// @notice Pays out a settled call. If nobody has resolved it yet and it can be settled, settles it first.
    ///         HIT: the caller gets the bond. STOPPED: takers split it by covered notional. EXPIRED: takers
    ///         split the forfeit, the caller gets the rest. Nobody took it: the caller gets the bond back.
    function claim(uint256 id) external nonReentrant {
        if (id == 0 || id > _calls.length) revert NoSuchCall();
        Result storage r = _results[id];
        if (r.outcome == Outcome.None && !_settle(id, false)) revert NotClaimable();
        if (_claimed[id][msg.sender]) revert AlreadyClaimed();
        uint256 amount = _claimable(id, msg.sender);
        if (amount == 0) revert NothingToClaim();

        _claimed[id][msg.sender] = true;
        r.claimedTotal += uint128(amount);
        emit Claimed(id, msg.sender, amount);
        _push(msg.sender, amount);
    }

    function claimableOf(uint256 id, address who) external view returns (uint256) {
        if (id == 0 || id > _calls.length || _claimed[id][who]) return 0;
        return _claimable(id, who);
    }

    function _claimable(uint256 id, address who) private view returns (uint256) {
        Result storage r = _results[id];
        if (r.outcome == Outcome.None) return 0;
        address caller = _calls[id - 1].caller;
        uint256 covered = _takes[id].covered;
        uint256 forfeit = covered == 0 ? 0 : r.forfeit; // nobody covered: nobody to compensate
        uint256 amount;
        if (who == caller) amount = uint256(r.bond) - forfeit;
        if (forfeit > 0) amount += forfeit * _takers[id][who].covered / covered;
        return amount;
    }

    // ------------------------------------------------------------------ reserve

    /// @notice Lets the steward move the native STT reserve (the 32 STT Somnia requires of a subscription
    ///         owner) to a successor contract. It cannot touch bonds, calls or outcomes.
    function withdrawReserve(address payable to, uint256 amount) external nonReentrant {
        if (msg.sender != steward) revert NotSteward();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit ReserveWithdrawn(to, amount);
    }

    // ------------------------------------------------------------------ token transfers

    function _pull(address from, uint256 amount) private {
        (bool ok, bytes memory ret) =
            bondToken.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", from, address(this), amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _push(address to, uint256 amount) private {
        (bool ok, bytes memory ret) = bondToken.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    // ------------------------------------------------------------------ views

    /// @notice The caller's open call on a pool (not closed, not expired, not resolved), or 0.
    function openCallOf(address caller, address pool) public view returns (uint256 id) {
        id = _latest[caller][pool];
        if (id == 0) return 0;
        Call storage c = _calls[id - 1];
        if (c.closedAt != 0 || c.expiresAt <= block.timestamp || _results[id].outcome != Outcome.None) return 0;
    }

    function getCall(uint256 id) external view returns (Call memory) {
        if (id == 0 || id > _calls.length) revert NoSuchCall();
        return _calls[id - 1];
    }

    function getTakes(uint256 id) external view returns (Takes memory) {
        if (id == 0 || id > _calls.length) revert NoSuchCall();
        return _takes[id];
    }

    function getResult(uint256 id) external view returns (Result memory) {
        if (id == 0 || id > _calls.length) revert NoSuchCall();
        return _results[id];
    }

    function getRecord(address caller) external view returns (Record memory) {
        return _records[caller];
    }

    function hasTaken(uint256 id, address taker) external view returns (bool) {
        return _takers[id][taker].seen;
    }

    function feeOf(uint256 id, address taker) external view returns (uint256) {
        return _takers[id][taker].fee;
    }

    function coveredOf(uint256 id, address taker) external view returns (uint256) {
        return _takers[id][taker].covered;
    }

    function callCount() external view returns (uint256) {
        return _calls.length;
    }

    function callsOf(address caller) external view returns (uint256[] memory) {
        return _callsOf[caller];
    }
}
