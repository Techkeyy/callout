// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CallBook} from "../src/CallBook.sol";
import {MockERC20, MockPool, MockBank, MockPrecompile} from "./Mocks.sol";

abstract contract Base is Test {
    event TakeRecorded(uint256 indexed id, address indexed taker, uint256 amount);
    event TakeOverCapacity(uint256 indexed id, address indexed taker, uint256 uncoveredNotional);
    event Resolved(uint256 indexed id, uint8 outcome, uint256 price);
    event Claimed(uint256 indexed id, address indexed who, uint256 amount);

    address constant PRECOMPILE = address(0x0100);
    bytes32 constant TOPIC0 = keccak256("BuilderFeeCharged(address,address,address,uint256)");
    bytes32 constant SCHEDULE = keccak256("Schedule(uint256)");

    uint128 constant MIN_BOND = 5e18;
    uint128 constant BOND = 100e18;
    uint128 constant CAP = 5_000e18; // bond is exactly 2% of capacity
    uint128 constant E = 100e18;
    uint128 constant UP = 120e18; // long target, short stop
    uint128 constant DOWN = 90e18; // long stop (10%: the widest allowed)
    uint128 constant SSTOP = 110e18; // short stop (10%)
    uint128 constant STGT = 80e18; // short target

    CallBook book;
    MockERC20 token;
    MockBank bank;
    MockPool pm;
    MockPool pm2;
    address pool;
    address pool2;
    address steward = makeAddr("steward");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address t1 = makeAddr("taker1");
    address t2 = makeAddr("taker2");
    address rando = makeAddr("rando");

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        token = new MockERC20();
        bank = new MockBank();
        pm = new MockPool();
        pm2 = new MockPool();
        pool = address(pm);
        pool2 = address(pm2);
        pm.set(true, E);
        pm2.set(true, E);
        bank.register(pool);
        bank.register(pool2);
        book = new CallBook(address(bank), address(token), MIN_BOND, steward);
        vm.etch(PRECOMPILE, address(new MockPrecompile()).code);
        address[3] memory who = [alice, bob, address(this)];
        for (uint256 i; i < 3; i++) {
            token.mint(who[i], 100_000e18);
            vm.prank(who[i]);
            token.approve(address(book), type(uint256).max);
        }
    }

    function _exp() internal view returns (uint64) {
        return uint64(block.timestamp + 1 days);
    }

    function _postLong() internal returns (uint256) {
        vm.prank(alice);
        return book.post(pool, true, E, DOWN, UP, _exp(), "l", CAP, BOND);
    }

    function _postShort() internal returns (uint256) {
        vm.prank(alice);
        return book.post(pool, false, E, SSTOP, STGT, _exp(), "s", CAP, BOND);
    }

    /// @dev A builder-fee event for a fill of `notional` by `payer` on alice's call (fee = notional / 1000).
    function _take(address payer, uint256 notional) internal {
        _takeOn(payer, alice, pool, notional);
    }

    function _takeOn(address payer, address builder, address p, uint256 notional) internal {
        bytes32[] memory t = new bytes32[](4);
        t[0] = TOPIC0;
        t[1] = bytes32(uint256(uint160(payer)));
        t[2] = bytes32(uint256(uint160(builder)));
        t[3] = bytes32(uint256(uint160(p)));
        vm.prank(PRECOMPILE, address(book));
        book.onEvent(address(bank), t, abi.encode(notional / 1000));
    }

    function _fireSchedule(uint256 ms) internal {
        bytes32[] memory t = new bytes32[](2);
        t[0] = SCHEDULE;
        t[1] = bytes32(ms);
        vm.prank(PRECOMPILE, address(book));
        book.onEvent(PRECOMPILE, t, "");
    }

    function _outcome(uint256 id) internal view returns (uint8) {
        return uint8(book.getResult(id).outcome);
    }
}
