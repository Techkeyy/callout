// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CallBook} from "../src/CallBook.sol";
import {MockERC20, MockPool} from "./Mocks.sol";

contract BondTest is Test {
    event Resolved(uint256 indexed id, uint8 outcome, uint256 price);
    event Claimed(uint256 indexed id, address indexed who, uint256 amount);

    address constant BANK = 0x478769E1177C0773c43A593DCCc4Ad15F15F1394;
    address constant PRECOMPILE = address(0x0100);
    bytes32 constant TOPIC0 = keccak256("BuilderFeeCharged(address,address,address,uint256)");

    uint128 constant BOND = 100e18;
    uint128 constant MIN_BOND = 5e18;
    uint128 constant E = 100e18;
    uint128 constant UP = 120e18;
    uint128 constant DOWN = 90e18;

    CallBook book;
    MockERC20 token;
    MockPool poolMock;
    address pool;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address t1 = makeAddr("taker1");
    address t2 = makeAddr("taker2");
    address rando = makeAddr("rando");

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new MockERC20();
        poolMock = new MockPool();
        pool = address(poolMock);
        poolMock.set(true, E);
        book = new CallBook(BANK, address(token), MIN_BOND);
        address[2] memory who = [alice, bob];
        for (uint256 i; i < 2; i++) {
            token.mint(who[i], 1000e18);
            vm.prank(who[i]);
            token.approve(address(book), type(uint256).max);
        }
    }

    function _postLong() internal returns (uint256) {
        vm.prank(alice);
        return book.post(pool, true, E, DOWN, UP, uint64(block.timestamp + 1 days), "l", BOND);
    }

    function _postShort() internal returns (uint256) {
        vm.prank(alice);
        return book.post(pool, false, E, UP, DOWN, uint64(block.timestamp + 1 days), "s", BOND);
    }

    function _take(address payer, uint256 amount) internal {
        bytes32[] memory t = new bytes32[](4);
        t[0] = TOPIC0;
        t[1] = bytes32(uint256(uint160(payer)));
        t[2] = bytes32(uint256(uint160(alice)));
        t[3] = bytes32(uint256(uint160(pool)));
        vm.prank(PRECOMPILE, address(book));
        book.onEvent(BANK, t, abi.encode(amount));
    }

    // ---- post / bond ----

    function test_postPullsBond() public {
        _postLong();
        assertEq(token.balanceOf(alice), 900e18);
        assertEq(token.balanceOf(address(book)), BOND);
        assertEq(book.getResult(1).bond, BOND);
        assertEq(uint8(book.getResult(1).outcome), 0);
    }

    function test_bondTooSmall() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(CallBook.BondTooSmall.selector);
        book.post(pool, true, E, DOWN, UP, exp, "l", MIN_BOND - 1);
        vm.prank(alice);
        book.post(pool, true, E, DOWN, UP, exp, "l", MIN_BOND); // exactly min ok
    }

    function test_postNeedsAllowanceAndBalance() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        address carol = makeAddr("carol");
        token.mint(carol, 1000e18);
        vm.prank(carol); // balance but no allowance
        vm.expectRevert(); // mock underflows on allowance
        book.post(pool, true, E, DOWN, UP, exp, "l", BOND);

        address dave = makeAddr("dave");
        vm.prank(dave);
        token.approve(address(book), type(uint256).max);
        vm.prank(dave); // allowance but no balance
        vm.expectRevert();
        book.post(pool, true, E, DOWN, UP, exp, "l", BOND);
    }

    function test_postRevertsOnFalseReturn() public {
        // a token whose transferFrom returns false must revert TransferFailed
        FalseToken ft = new FalseToken();
        CallBook b2 = new CallBook(BANK, address(ft), MIN_BOND);
        uint64 exp = uint64(block.timestamp + 1 days);
        vm.expectRevert(CallBook.TransferFailed.selector);
        b2.post(pool, true, E, DOWN, UP, exp, "l", BOND);
    }

    // ---- resolve ----

    function test_resolve_longBoundaries() public {
        uint256 id = _postLong();
        poolMock.set(true, UP - 1);
        vm.expectRevert(CallBook.NotResolvable.selector);
        book.resolve(id);
        poolMock.set(true, DOWN + 1);
        vm.expectRevert(CallBook.NotResolvable.selector);
        book.resolve(id);

        poolMock.set(true, UP); // exact target = Hit
        vm.expectEmit(true, false, false, true);
        emit Resolved(id, 1, UP);
        vm.prank(rando); // anyone
        book.resolve(id);
        assertEq(uint8(book.getResult(id).outcome), 1);
        assertEq(book.getResult(id).price, UP);
        assertEq(book.getResult(id).resolvedAt, block.timestamp);

        // second long, exact stop
        uint256 id2 = _postLong();
        poolMock.set(true, DOWN);
        book.resolve(id2);
        assertEq(uint8(book.getResult(id2).outcome), 2);
    }

    function test_resolve_shortBoundaries() public {
        uint256 id = _postShort();
        poolMock.set(true, DOWN + 1);
        vm.expectRevert(CallBook.NotResolvable.selector);
        book.resolve(id);
        poolMock.set(true, UP - 1);
        vm.expectRevert(CallBook.NotResolvable.selector);
        book.resolve(id);

        poolMock.set(true, DOWN); // exact target = Hit
        book.resolve(id);
        assertEq(uint8(book.getResult(id).outcome), 1);

        uint256 id2 = _postShort();
        poolMock.set(true, UP); // exact stop = Stopped
        book.resolve(id2);
        assertEq(uint8(book.getResult(id2).outcome), 2);
    }

    function test_resolve_beyondLevels() public {
        uint256 id = _postLong();
        poolMock.set(true, 500e18);
        book.resolve(id);
        assertEq(uint8(book.getResult(id).outcome), 1);
        uint256 id2 = _postLong();
        poolMock.set(true, 1);
        book.resolve(id2);
        assertEq(uint8(book.getResult(id2).outcome), 2);
    }

    function test_resolve_stalePrice() public {
        uint256 id = _postLong();
        poolMock.set(false, UP);
        vm.expectRevert(CallBook.StalePrice.selector);
        book.resolve(id);
    }

    function test_resolve_expiredNoPriceRead() public {
        uint256 id = _postLong();
        poolMock.set(false, 0); // price source broken: must not matter
        vm.warp(block.timestamp + 1 days); // exactly expiresAt
        vm.expectEmit(true, false, false, true);
        emit Resolved(id, 3, 0);
        book.resolve(id);
        assertEq(uint8(book.getResult(id).outcome), 3);
    }

    function test_resolve_expiredWinsOverCrossedPrice() public {
        uint256 id = _postLong();
        poolMock.set(true, UP);
        vm.warp(block.timestamp + 2 days);
        book.resolve(id);
        assertEq(uint8(book.getResult(id).outcome), 3);
    }

    function test_resolve_alreadyResolvedAndUnknown() public {
        uint256 id = _postLong();
        poolMock.set(true, UP);
        book.resolve(id);
        vm.expectRevert(CallBook.AlreadyResolved.selector);
        book.resolve(id);
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.resolve(0);
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.resolve(99);
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.getResult(99);
    }

    function test_loophole_closeDoesNotEndExposure() public {
        uint256 id = _postLong();
        vm.prank(alice);
        book.close(id); // caller "is out"
        poolMock.set(true, DOWN - 1); // price then crosses the stop
        book.resolve(id);
        assertEq(uint8(book.getResult(id).outcome), 2);
        assertEq(book.getRecord(alice).stops, 1);
    }

    function test_takesStopAfterResolution_andRepost() public {
        uint256 id = _postLong();
        _take(t1, 1e18);
        poolMock.set(true, UP);
        book.resolve(id);
        assertEq(book.openCallOf(alice, pool), 0);
        _take(t2, 1e18); // ignored
        assertEq(book.getTakes(id).fills, 1);
        assertEq(book.getTakes(id).takers, 1);
        poolMock.set(true, E);
        assertEq(_postLong(), 2); // same pool again after resolution
        assertEq(book.openCallOf(alice, pool), 2);
    }

    // ---- claims ----

    function test_claim_hit() public {
        uint256 id = _postLong();
        poolMock.set(true, UP);
        book.resolve(id);
        assertEq(book.claimableOf(id, alice), BOND);
        assertEq(book.claimableOf(id, bob), 0);
        vm.expectEmit(true, true, false, true);
        emit Claimed(id, alice, BOND);
        vm.prank(alice);
        book.claim(id);
        assertEq(token.balanceOf(alice), 1000e18);
        assertEq(book.getResult(id).claimedTotal, BOND);
        assertEq(book.claimableOf(id, alice), 0);
        vm.prank(alice);
        vm.expectRevert(CallBook.AlreadyClaimed.selector);
        book.claim(id);
    }

    function test_claim_hitTakerCannot() public {
        uint256 id = _postLong();
        _take(t1, 1e18);
        poolMock.set(true, UP);
        book.resolve(id);
        vm.prank(t1);
        vm.expectRevert(CallBook.NothingToClaim.selector);
        book.claim(id);
    }

    function test_claim_expired() public {
        uint256 id = _postLong();
        vm.warp(block.timestamp + 1 days);
        book.resolve(id);
        vm.prank(alice);
        book.claim(id);
        assertEq(token.balanceOf(alice), 1000e18);
    }

    function test_claim_notResolved() public {
        uint256 id = _postLong();
        vm.prank(alice);
        vm.expectRevert(CallBook.NotClaimable.selector);
        book.claim(id);
        assertEq(book.claimableOf(id, alice), 0);
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.claim(7);
    }

    function test_claim_stoppedProRata() public {
        uint256 id = _postLong();
        _take(t1, 1e18);
        _take(t2, 3e18);
        poolMock.set(true, DOWN);
        book.resolve(id);

        assertEq(book.feeOf(id, t1), 1e18);
        assertEq(book.claimableOf(id, t1), 25e18);
        assertEq(book.claimableOf(id, t2), 75e18);
        assertEq(book.claimableOf(id, alice), 0);

        vm.prank(alice);
        vm.expectRevert(CallBook.NothingToClaim.selector); // caller can't claim when takers exist
        book.claim(id);
        vm.prank(rando);
        vm.expectRevert(CallBook.NothingToClaim.selector); // non-taker
        book.claim(id);

        vm.prank(t1);
        book.claim(id);
        vm.prank(t2);
        book.claim(id);
        assertEq(token.balanceOf(t1), 25e18);
        assertEq(token.balanceOf(t2), 75e18);
        assertEq(token.balanceOf(address(book)), 0);
        assertEq(book.getResult(id).claimedTotal, BOND);

        vm.prank(t1);
        vm.expectRevert(CallBook.AlreadyClaimed.selector);
        book.claim(id);
    }

    function test_claim_stoppedMultipleFillsSamePayer() public {
        uint256 id = _postLong();
        _take(t1, 1e18);
        _take(t2, 1e18);
        _take(t1, 2e18); // t1 total 3, t2 1
        poolMock.set(true, DOWN);
        book.resolve(id);
        assertEq(book.claimableOf(id, t1), 75e18);
        assertEq(book.claimableOf(id, t2), 25e18);
    }

    function test_claim_stoppedNoTakersRefundsCaller() public {
        uint256 id = _postLong();
        poolMock.set(true, DOWN);
        book.resolve(id);
        assertEq(book.claimableOf(id, alice), BOND);
        vm.prank(alice);
        book.claim(id);
        assertEq(token.balanceOf(alice), 1000e18);
        vm.prank(bob);
        vm.expectRevert(CallBook.NothingToClaim.selector);
        book.claim(id);
    }

    function test_claim_roundingDustStays() public {
        uint256 id = _postLong();
        _take(t1, 1);
        _take(t2, 1);
        _take(rando, 1); // bond 100e18 / 3 each, dust 1 wei
        poolMock.set(true, DOWN);
        book.resolve(id);
        vm.prank(t1);
        book.claim(id);
        vm.prank(t2);
        book.claim(id);
        vm.prank(rando);
        book.claim(id);
        assertEq(token.balanceOf(address(book)), 1);
    }

    // ---- record ----

    function test_record() public {
        // hit
        uint256 a = _postLong();
        poolMock.set(true, UP);
        book.resolve(a);
        // stop
        poolMock.set(true, E);
        uint256 b = _postLong();
        poolMock.set(true, DOWN);
        book.resolve(b);
        // second stop
        poolMock.set(true, E);
        uint256 c = _postLong();
        poolMock.set(true, 1);
        book.resolve(c);
        // expired
        poolMock.set(true, E);
        uint256 d = _postLong();
        vm.warp(block.timestamp + 1 days);
        book.resolve(d);

        CallBook.Record memory r = book.getRecord(alice);
        assertEq(r.hits, 1);
        assertEq(r.stops, 2);
        assertEq(r.expired, 1);
        assertEq(book.getRecord(bob).hits, 0);
    }

    // ---- gas ----

    function test_gas_firstAndRepeatTake() public {
        _postLong();
        bytes32[] memory t = new bytes32[](4);
        t[0] = TOPIC0;
        t[1] = bytes32(uint256(uint160(t1)));
        t[2] = bytes32(uint256(uint160(alice)));
        t[3] = bytes32(uint256(uint160(pool)));
        bytes memory d = abi.encode(uint256(1e18));
        vm.startPrank(PRECOMPILE, address(book));
        uint256 g = gasleft();
        book.onEvent(BANK, t, d);
        emit log_named_uint("v3 gas first take (new payer)", g - gasleft());
        g = gasleft();
        book.onEvent(BANK, t, d);
        emit log_named_uint("v3 gas repeat take (same payer)", g - gasleft());
        vm.stopPrank();
    }
}

contract FalseToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}
