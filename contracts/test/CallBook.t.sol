// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CallBook} from "../src/CallBook.sol";

contract CallBookTest is Test {
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

    CallBook book;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address pool = makeAddr("pool");

    uint128 constant E = 100e18;
    uint128 constant UP = 120e18;
    uint128 constant DOWN = 90e18;

    function setUp() public {
        vm.warp(1_700_000_000);
        book = new CallBook(address(0x478769E1177C0773c43A593DCCc4Ad15F15F1394));
    }

    function _exp() internal view returns (uint64) {
        return uint64(block.timestamp + 1 days);
    }

    function _postLong(address who) internal returns (uint256) {
        vm.prank(who);
        return book.post(pool, true, E, DOWN, UP, _exp(), "long thesis");
    }

    // ---- happy paths ----

    function test_postLong() public {
        uint64 exp = _exp();
        vm.expectEmit(true, true, true, true);
        emit CallPosted(1, alice, pool, true, E, DOWN, UP, exp, "btc to the moon");
        vm.prank(alice);
        uint256 id = book.post(pool, true, E, DOWN, UP, exp, "btc to the moon");

        assertEq(id, 1);
        assertEq(book.callCount(), 1);
        CallBook.Call memory c = book.getCall(1);
        assertEq(c.caller, alice);
        assertEq(c.pool, pool);
        assertTrue(c.isLong);
        assertEq(c.postedAt, block.timestamp);
        assertEq(c.expiresAt, exp);
        assertEq(c.closedAt, 0);
        assertEq(c.entry, E);
        assertEq(c.stop, DOWN);
        assertEq(c.target, UP);
        assertEq(c.note, "btc to the moon");
    }

    function test_postShort() public {
        uint64 exp = _exp();
        vm.expectEmit(true, true, true, true);
        emit CallPosted(1, bob, pool, false, E, UP, DOWN, exp, "fade it");
        vm.prank(bob);
        uint256 id = book.post(pool, false, E, UP, DOWN, exp, "fade it");

        assertEq(id, 1);
        CallBook.Call memory c = book.getCall(1);
        assertEq(c.caller, bob);
        assertFalse(c.isLong);
        assertEq(c.entry, E);
        assertEq(c.stop, UP);
        assertEq(c.target, DOWN);
        assertEq(c.note, "fade it");
    }

    function test_idsIncrementAndCallsOf() public {
        assertEq(_postLong(alice), 1);
        assertEq(_postLong(bob), 2);
        vm.prank(alice); assertEq(book.post(makeAddr("pool2"), true, E, DOWN, UP, _exp(), "s"), 3);
        assertEq(book.callCount(), 3);

        uint256[] memory a = book.callsOf(alice);
        assertEq(a.length, 2);
        assertEq(a[0], 1);
        assertEq(a[1], 3);
        uint256[] memory b = book.callsOf(bob);
        assertEq(b.length, 1);
        assertEq(b[0], 2);
        assertEq(book.callsOf(makeAddr("nobody")).length, 0);
    }

    function test_emptyNoteAllowed() public {
        book.post(pool, true, E, DOWN, UP, _exp(), "");
        assertEq(book.getCall(1).note, "");
    }

    // ---- post reverts ----

    function test_revert_zeroPool() public {
        uint64 exp = _exp();
        vm.expectRevert(CallBook.ZeroPool.selector);
        book.post(address(0), true, E, DOWN, UP, exp, "x");
    }

    function test_revert_longBadOrdering() public {
        uint64 exp = _exp();
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, true, E, UP, DOWN, exp, "x"); // stop above entry
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, true, E, E, UP, exp, "x"); // stop == entry
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, true, E, DOWN, E, exp, "x"); // target == entry
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, true, E, DOWN, DOWN, exp, "x"); // target below entry
    }

    function test_revert_shortBadOrdering() public {
        uint64 exp = _exp();
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, false, E, DOWN, UP, exp, "x"); // long-shaped prices
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, false, E, E, DOWN, exp, "x"); // stop == entry
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, false, E, UP, E, exp, "x"); // target == entry
    }

    function test_revert_zeroPrices() public {
        uint64 exp = _exp();
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, true, 0, 0, UP, exp, "x");
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, true, E, 0, UP, exp, "x"); // zero stop on a long
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, false, E, UP, 0, exp, "x"); // zero target on a short
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, false, 0, UP, 0, exp, "x");
    }

    function test_expiryBoundaries() public {
        uint64 nowTs = uint64(block.timestamp);
        vm.expectRevert(CallBook.BadExpiry.selector);
        book.post(pool, true, E, DOWN, UP, nowTs, "x"); // exactly now
        vm.expectRevert(CallBook.BadExpiry.selector);
        book.post(pool, true, E, DOWN, UP, nowTs - 1, "x"); // past
        book.post(pool, true, E, DOWN, UP, nowTs + 1, "x"); // now + 1 ok
        book.post(makeAddr("pool2"), true, E, DOWN, UP, nowTs + 30 days, "x"); // exactly +30 days ok
        vm.expectRevert(CallBook.BadExpiry.selector);
        book.post(pool, true, E, DOWN, UP, nowTs + 30 days + 1, "x");
        assertEq(book.callCount(), 2);
    }

    function test_noteLengthBoundary() public {
        bytes memory ok = new bytes(280);
        for (uint256 i; i < 280; i++) ok[i] = "a";
        book.post(pool, true, E, DOWN, UP, _exp(), string(ok));
        assertEq(bytes(book.getCall(1).note).length, 280);

        bytes memory tooLong = new bytes(281);
        for (uint256 i; i < 281; i++) tooLong[i] = "a";
        uint64 exp = _exp();
        vm.expectRevert(CallBook.NoteTooLong.selector);
        book.post(pool, true, E, DOWN, UP, exp, string(tooLong));
    }

    function test_noteLimitIsBytesNotChars() public {
        // 141 two-byte characters (0xC3 0xA9) = 282 bytes, but only 141 characters
        bytes memory b = new bytes(282);
        for (uint256 i; i < 282; i += 2) {
            b[i] = 0xC3;
            b[i + 1] = 0xA9;
        }
        uint64 exp = _exp();
        vm.expectRevert(CallBook.NoteTooLong.selector);
        book.post(pool, true, E, DOWN, UP, exp, string(b));
    }

    // ---- close ----

    function test_close() public {
        _postLong(alice);
        vm.warp(block.timestamp + 100);
        vm.expectEmit(true, true, false, true);
        emit CallClosed(1, alice, uint64(block.timestamp));
        vm.prank(alice);
        book.close(1);
        assertEq(book.getCall(1).closedAt, block.timestamp);
    }

    function test_revert_closeByOther() public {
        _postLong(alice);
        vm.prank(bob);
        vm.expectRevert(CallBook.NotCaller.selector);
        book.close(1);
        assertEq(book.getCall(1).closedAt, 0);
    }

    function test_revert_closeTwice() public {
        _postLong(alice);
        vm.startPrank(alice);
        book.close(1);
        uint64 first = book.getCall(1).closedAt;
        vm.warp(block.timestamp + 5);
        vm.expectRevert(CallBook.AlreadyClosed.selector);
        book.close(1);
        vm.stopPrank();
        assertEq(book.getCall(1).closedAt, first);
    }

    function test_revert_closeUnknown() public {
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.close(0);
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.close(1);
        _postLong(alice);
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.close(2);
    }

    function test_revert_getCallUnknown() public {
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.getCall(0);
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.getCall(1);
        _postLong(alice);
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.getCall(2);
    }

    // ---- immutability ----

    function test_termsImmutableAcrossTimeAndClose() public {
        uint64 exp = _exp();
        vm.prank(alice);
        book.post(pool, false, E, UP, DOWN, exp, "locked in");
        CallBook.Call memory before_ = book.getCall(1);

        vm.warp(block.timestamp + 365 days); // far past expiry
        vm.prank(alice);
        book.close(1);

        CallBook.Call memory after_ = book.getCall(1);
        assertEq(after_.caller, before_.caller);
        assertEq(after_.pool, before_.pool);
        assertEq(after_.isLong, before_.isLong);
        assertEq(after_.postedAt, before_.postedAt);
        assertEq(after_.expiresAt, before_.expiresAt);
        assertEq(after_.entry, before_.entry);
        assertEq(after_.stop, before_.stop);
        assertEq(after_.target, before_.target);
        assertEq(after_.note, before_.note);
        assertGt(after_.closedAt, 0); // only closedAt changed
    }

    // ---- fuzz ----

    function testFuzz_longPriceOrdering(uint128 entry, uint128 stop, uint128 target) public {
        uint64 exp = _exp();
        bool valid = stop > 0 && stop < entry && entry < target;
        if (!valid) vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, true, entry, stop, target, exp, "f");
        if (valid) {
            CallBook.Call memory c = book.getCall(1);
            assertEq(c.entry, entry);
            assertEq(c.stop, stop);
            assertEq(c.target, target);
        }
    }

    function testFuzz_shortPriceOrdering(uint128 entry, uint128 stop, uint128 target) public {
        uint64 exp = _exp();
        bool valid = target > 0 && target < entry && entry < stop;
        if (!valid) vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, false, entry, stop, target, exp, "f");
        if (valid) {
            CallBook.Call memory c = book.getCall(1);
            assertEq(c.entry, entry);
            assertEq(c.stop, stop);
            assertEq(c.target, target);
        }
    }
}
