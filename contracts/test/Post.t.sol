// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.sol";
import {CallBook} from "../src/CallBook.sol";
import {MockPool} from "./Mocks.sol";

/// Rules at post (docs/v4-mechanism.md "Rules at post").
contract PostTest is Base {
    function test_postLongStoresTermsAndPullsBond() public {
        uint256 before = token.balanceOf(alice);
        uint256 id = _postLong();
        assertEq(id, 1);
        CallBook.Call memory c = book.getCall(id);
        assertEq(c.caller, alice);
        assertEq(c.pool, pool);
        assertTrue(c.isLong);
        assertEq(c.entry, E);
        assertEq(c.stop, DOWN);
        assertEq(c.target, UP);
        assertEq(c.capacity, CAP);
        assertEq(book.getResult(id).bond, BOND);
        assertEq(token.balanceOf(alice), before - BOND);
        assertEq(token.balanceOf(address(book)), BOND);
    }

    function test_postShort() public {
        uint256 id = _postShort();
        assertFalse(book.getCall(id).isLong);
    }

    function test_revert_poolNotRegistered() public {
        MockPool fake = new MockPool();
        fake.set(true, E);
        vm.prank(alice);
        vm.expectRevert(CallBook.PoolNotRegistered.selector);
        book.post(address(fake), true, E, DOWN, UP, _exp(), "x", CAP, BOND);
    }

    function test_revert_zeroPool() public {
        vm.prank(alice);
        vm.expectRevert(CallBook.ZeroPool.selector);
        book.post(address(0), true, E, DOWN, UP, _exp(), "x", CAP, BOND);
    }

    function test_revert_stalePriceAtPost() public {
        pm.set(false, E);
        vm.prank(alice);
        vm.expectRevert(CallBook.StalePrice.selector);
        book.post(pool, true, E, DOWN, UP, _exp(), "x", CAP, BOND);
    }

    /// Dodge: post a target the market has already passed, then resolve an instant HIT.
    function test_dodge_targetAlreadyPassed_long() public {
        pm.set(true, 125e18);
        vm.prank(alice);
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, true, E, DOWN, UP, _exp(), "x", CAP, BOND);
    }

    function test_dodge_targetAlreadyPassed_short() public {
        pm.set(true, 85e18);
        vm.prank(alice);
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, false, E, UP, DOWN, _exp(), "x", CAP, BOND);
    }

    function test_revert_markAtLevelIsNotBetween() public {
        pm.set(true, UP); // mark exactly at the target
        vm.prank(alice);
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, true, E, DOWN, UP, _exp(), "x", CAP, BOND);
    }

    function test_entryDriftBoundary() public {
        // entry within 0.5% of the mark
        pm.set(true, E);
        vm.prank(alice);
        vm.expectRevert(CallBook.EntryOffMarket.selector);
        book.post(pool, true, 100.6e18, 92e18, 120e18, _exp(), "x", CAP, BOND);
        vm.prank(alice);
        book.post(pool, true, 100.5e18, 92e18, 120e18, _exp(), "x", CAP, BOND); // exactly 0.5% ok
    }

    /// Dodge: a wide stop that never triggers.
    function test_dodge_wideStop() public {
        vm.prank(alice);
        vm.expectRevert(CallBook.StopTooWide.selector);
        book.post(pool, true, E, 89.99e18, 130e18, _exp(), "x", CAP, BOND);
        vm.prank(alice);
        vm.expectRevert(CallBook.StopTooWide.selector);
        book.post(pool, false, E, 110.01e18, 80e18, _exp(), "x", CAP, BOND);
    }

    /// Dodge: one-tick levels as a coin flip.
    function test_dodge_tinyStop() public {
        vm.prank(alice);
        vm.expectRevert(CallBook.StopTooTight.selector);
        book.post(pool, true, E, 99.95e18, 101e18, _exp(), "x", CAP, BOND);
        vm.prank(alice);
        book.post(pool, true, E, 99.9e18, 101e18, _exp(), "x", CAP, BOND); // exactly 0.1% ok
    }

    function test_revert_rewardBelowRisk() public {
        vm.prank(alice);
        vm.expectRevert(CallBook.RewardBelowRisk.selector);
        book.post(pool, true, E, 95e18, 104e18, _exp(), "x", CAP, BOND);
        vm.prank(alice);
        book.post(pool, true, E, 95e18, 105e18, _exp(), "x", CAP, BOND); // exactly 1:1 ok
    }

    function test_revert_badOrdering() public {
        vm.startPrank(alice);
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, true, E, UP, DOWN, _exp(), "x", CAP, BOND);
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, false, E, DOWN, UP, _exp(), "x", CAP, BOND);
        vm.expectRevert(CallBook.BadPrices.selector);
        book.post(pool, true, E, 0, UP, _exp(), "x", CAP, BOND);
        vm.stopPrank();
    }

    /// Scale: the bond must cover 2% of the declared capacity.
    function test_bondScalesWithCapacity() public {
        vm.startPrank(alice);
        vm.expectRevert(CallBook.BondTooSmall.selector);
        book.post(pool, true, E, DOWN, UP, _exp(), "x", CAP + 1e18, BOND);
        vm.expectRevert(CallBook.BondTooSmall.selector);
        book.post(pool, true, E, DOWN, UP, _exp(), "x", 1e18, MIN_BOND - 1);
        vm.expectRevert(CallBook.ZeroCapacity.selector);
        book.post(pool, true, E, DOWN, UP, _exp(), "x", 0, BOND);
        book.post(pool, true, E, DOWN, UP, _exp(), "x", CAP, BOND);
        vm.stopPrank();
    }

    function test_expiryBoundaries() public {
        uint64 nowTs = uint64(block.timestamp);
        vm.startPrank(alice);
        vm.expectRevert(CallBook.BadExpiry.selector);
        book.post(pool, true, E, DOWN, UP, nowTs + 1, "x", CAP, BOND);
        vm.expectRevert(CallBook.BadExpiry.selector);
        book.post(pool, true, E, DOWN, UP, nowTs + 30 days + 1, "x", CAP, BOND);
        book.post(pool, true, E, DOWN, UP, nowTs + 2, "x", CAP, BOND);
        book.post(pool2, true, E, DOWN, UP, nowTs + 30 days, "x", CAP, BOND);
        vm.stopPrank();
    }

    function test_noteLength() public {
        bytes memory ok = new bytes(280);
        bytes memory bad = new bytes(281);
        vm.startPrank(alice);
        book.post(pool, true, E, DOWN, UP, _exp(), string(ok), CAP, BOND);
        vm.expectRevert(CallBook.NoteTooLong.selector);
        book.post(pool2, true, E, DOWN, UP, _exp(), string(bad), CAP, BOND);
        vm.stopPrank();
    }

    /// Dodge: a long and a short on the same market at once.
    function test_dodge_hedgeBothSides() public {
        _postLong();
        vm.prank(alice);
        vm.expectRevert(CallBook.AlreadyOpen.selector);
        book.post(pool, false, E, SSTOP, STGT, _exp(), "x", CAP, BOND);
        vm.prank(alice);
        book.post(pool2, false, E, SSTOP, STGT, _exp(), "x", CAP, BOND); // another market is fine
    }

    function test_closeOnlyByCallerOnce() public {
        uint256 id = _postLong();
        vm.prank(bob);
        vm.expectRevert(CallBook.NotCaller.selector);
        book.close(id);
        vm.prank(alice);
        book.close(id);
        vm.prank(alice);
        vm.expectRevert(CallBook.AlreadyClosed.selector);
        book.close(id);
        assertEq(book.openCallOf(alice, pool), 0);
    }

    function test_termsNeverChange() public {
        uint256 id = _postShort();
        CallBook.Call memory a = book.getCall(id);
        vm.warp(block.timestamp + 12 hours);
        vm.prank(alice);
        book.close(id);
        CallBook.Call memory b = book.getCall(id);
        assertEq(a.entry, b.entry);
        assertEq(a.stop, b.stop);
        assertEq(a.target, b.target);
        assertEq(a.capacity, b.capacity);
        assertEq(a.expiresAt, b.expiresAt);
        assertEq(keccak256(bytes(a.note)), keccak256(bytes(b.note)));
    }

    function testFuzz_postNeverAcceptsMarkOutsideLevels(uint128 mark) public {
        mark = uint128(bound(mark, 1, 1_000e18));
        pm.set(true, mark);
        vm.prank(alice);
        try book.post(pool, true, E, DOWN, UP, _exp(), "f", CAP, BOND) {
            assertGt(mark, DOWN);
            assertLt(mark, UP);
        } catch {}
    }
}
