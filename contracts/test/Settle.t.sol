// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.sol";
import {CallBook} from "../src/CallBook.sol";

/// Every row of the payoff table, and the resolution order (docs/v4-mechanism.md).
contract SettleTest is Base {
    uint8 constant HIT = 1;
    uint8 constant STOPPED = 2;
    uint8 constant EXPIRED = 3;

    // ---- before expiry ----

    function test_beforeExpiry_longLevels() public {
        uint256 id = _postLong();
        pm.set(true, 119.99e18);
        vm.expectRevert(CallBook.NotResolvable.selector);
        book.resolve(id);
        pm.set(true, UP);
        vm.prank(rando);
        book.resolve(id);
        assertEq(_outcome(id), HIT);
    }

    function test_beforeExpiry_shortStop() public {
        uint256 id = _postShort();
        pm.set(true, SSTOP);
        book.resolve(id);
        assertEq(_outcome(id), STOPPED);
        assertEq(book.getResult(id).forfeit, BOND);
    }

    function test_resolve_stalePrice() public {
        uint256 id = _postLong();
        pm.set(false, 50e18);
        vm.expectRevert(CallBook.StalePrice.selector);
        book.resolve(id);
    }

    function test_resolve_alreadyResolvedAndUnknown() public {
        uint256 id = _postLong();
        pm.set(true, UP);
        book.resolve(id);
        vm.expectRevert(CallBook.AlreadyResolved.selector);
        book.resolve(id);
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.resolve(99);
    }

    // ---- ordering: price before clock (the v3 bug) ----

    function test_order_stoppedCallResolvedLateIsStopped() public {
        uint256 id = _postLong();
        _take(t1, 1_000e18);
        vm.warp(block.timestamp + 2 days); // nobody resolved in time
        pm.set(true, 89e18); // past the stop
        book.resolve(id);
        assertEq(_outcome(id), STOPPED);
        assertEq(book.claimableOf(id, t1), BOND);
        assertEq(book.claimableOf(id, alice), 0);
    }

    function test_order_hitCallResolvedLateIsHit() public {
        uint256 id = _postLong();
        vm.warp(block.timestamp + 2 days);
        pm.set(true, 121e18);
        book.resolve(id);
        assertEq(_outcome(id), HIT);
    }

    // ---- expiry settles at the price ----

    function test_expired_inProfit_callerKeepsBond() public {
        uint256 id = _postLong();
        _take(t1, 1_000e18);
        vm.warp(block.timestamp + 1 days);
        pm.set(true, 110e18);
        book.resolve(id);
        assertEq(_outcome(id), EXPIRED);
        assertEq(book.getResult(id).forfeit, 0);
        assertEq(book.claimableOf(id, alice), BOND);
        assertEq(book.claimableOf(id, t1), 0);
        assertEq(book.getRecord(alice).expiredLosses, 0);
    }

    function test_expired_atEntry_noForfeit() public {
        uint256 id = _postLong();
        _take(t1, 1_000e18);
        vm.warp(block.timestamp + 1 days);
        pm.set(true, E);
        book.resolve(id);
        assertEq(book.getResult(id).forfeit, 0);
    }

    /// The farm the reviewer named: never stopped, never hit, fees kept. Now it costs the bond pro rata.
    function test_expired_againstCall_forfeitsProRata_long() public {
        uint256 id = _postLong();
        _take(t1, 1_000e18);
        _take(t2, 3_000e18);
        vm.warp(block.timestamp + 1 days);
        pm.set(true, 94e18); // 6 of the 10 to the stop
        book.resolve(id);
        CallBook.Result memory r = book.getResult(id);
        assertEq(uint8(r.outcome), EXPIRED);
        assertEq(r.forfeit, 60e18);
        assertEq(book.claimableOf(id, alice), 40e18);
        assertEq(book.claimableOf(id, t1), 15e18);
        assertEq(book.claimableOf(id, t2), 45e18);
        assertEq(book.getRecord(alice).expiredLosses, 1);
    }

    function test_expired_againstCall_short() public {
        uint256 id = _postShort();
        _take(t1, 1_000e18);
        vm.warp(block.timestamp + 1 days);
        pm.set(true, 105e18); // risk 10, adverse 5: half the bond
        book.resolve(id);
        assertEq(book.getResult(id).forfeit, 50e18);
        assertEq(book.claimableOf(id, t1), 50e18);
        assertEq(book.claimableOf(id, alice), 50e18);
    }

    function test_expired_pastStopIsStopped() public {
        uint256 id = _postLong();
        vm.warp(block.timestamp + 1 days);
        pm.set(true, DOWN);
        book.resolve(id);
        assertEq(_outcome(id), STOPPED);
    }

    function test_expired_stalePriceCannotSettle() public {
        uint256 id = _postLong();
        vm.warp(block.timestamp + 1 days);
        pm.set(false, 0);
        vm.expectRevert(CallBook.StalePrice.selector);
        book.resolve(id);
    }

    // ---- claims: every row ----

    function test_claim_hit_callerOnly() public {
        uint256 id = _postLong();
        _take(t1, 1_000e18);
        pm.set(true, UP);
        book.resolve(id);
        vm.prank(t1);
        vm.expectRevert(CallBook.NothingToClaim.selector);
        book.claim(id);
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        book.claim(id);
        assertEq(token.balanceOf(alice), before + BOND);
    }

    function test_claim_stopped_takersSplitByCovered() public {
        uint256 id = _postLong();
        _take(t1, 1_000e18);
        _take(t2, 3_000e18);
        pm.set(true, DOWN);
        book.resolve(id);
        vm.prank(t1);
        book.claim(id);
        vm.prank(t2);
        book.claim(id);
        assertEq(token.balanceOf(t1), 25e18);
        assertEq(token.balanceOf(t2), 75e18);
        vm.prank(alice);
        vm.expectRevert(CallBook.NothingToClaim.selector);
        book.claim(id);
    }

    function test_claim_noTakers_callerGetsBondInEveryOutcome() public {
        uint256 a = _postLong();
        pm.set(true, DOWN);
        book.resolve(a);
        assertEq(book.claimableOf(a, alice), BOND);
        assertEq(book.getRecord(alice).stops, 1); // the record still counts the miss

        pm.set(true, E);
        uint256 b = _postLong();
        vm.warp(block.timestamp + 1 days);
        pm.set(true, 95e18);
        book.resolve(b);
        assertEq(book.claimableOf(b, alice), BOND);
    }

    function test_claim_twiceAndNonParticipant() public {
        uint256 id = _postLong();
        _take(t1, 1_000e18);
        pm.set(true, DOWN);
        book.resolve(id);
        vm.prank(t1);
        book.claim(id);
        vm.prank(t1);
        vm.expectRevert(CallBook.AlreadyClaimed.selector);
        book.claim(id);
        vm.prank(rando);
        vm.expectRevert(CallBook.NothingToClaim.selector);
        book.claim(id);
    }

    /// Liveness: claim settles the call first if nobody resolved it.
    function test_claim_autoSettles() public {
        uint256 id = _postLong();
        _take(t1, 1_000e18);
        pm.set(true, DOWN);
        vm.prank(t1);
        book.claim(id);
        assertEq(_outcome(id), STOPPED);
        assertEq(token.balanceOf(t1), BOND);
    }

    function test_claim_beforeSettleableReverts() public {
        uint256 id = _postLong();
        vm.prank(alice);
        vm.expectRevert(CallBook.NotClaimable.selector);
        book.claim(id);
    }

    function test_claim_neverPaysMoreThanBond() public {
        uint256 id = _postLong();
        _take(t1, 333e18);
        _take(t2, 667e18);
        _take(bob, 1e18);
        vm.warp(block.timestamp + 1 days);
        pm.set(true, 93.3e18);
        book.resolve(id);
        vm.prank(alice);
        book.claim(id);
        vm.prank(t1);
        book.claim(id);
        vm.prank(t2);
        book.claim(id);
        vm.prank(bob);
        book.claim(id);
        assertLe(book.getResult(id).claimedTotal, BOND);
        assertLe(token.balanceOf(address(book)), 1e6); // only rounding dust remains
    }

    function test_record_agreesWithMoney() public {
        // hit
        uint256 a = _postLong();
        pm.set(true, UP);
        book.resolve(a);
        // stop
        pm.set(true, E);
        uint256 b = _postLong();
        pm.set(true, DOWN);
        book.resolve(b);
        // expired in profit
        pm.set(true, E);
        uint256 c = _postLong();
        vm.warp(block.timestamp + 1 days);
        pm.set(true, 101e18);
        book.resolve(c);
        // expired at a loss
        pm.set(true, E);
        uint256 d = _postLong();
        vm.warp(block.timestamp + 1 days);
        pm.set(true, 99e18);
        book.resolve(d);
        CallBook.Record memory r = book.getRecord(alice);
        assertEq(r.hits, 1);
        assertEq(r.stops, 1);
        assertEq(r.expired, 2);
        assertEq(r.expiredLosses, 1);
    }

    /// Exposure continues after close(): closing is not an escape hatch.
    function test_closeDoesNotEndExposure() public {
        uint256 id = _postLong();
        _take(t1, 1_000e18);
        vm.prank(alice);
        book.close(id);
        pm.set(true, DOWN);
        book.resolve(id);
        assertEq(book.claimableOf(id, t1), BOND);
    }

    function testFuzz_expiredForfeitBounded(uint128 price) public {
        uint256 id = _postLong();
        _take(t1, 1_000e18);
        vm.warp(block.timestamp + 1 days);
        price = uint128(bound(price, 1, 200e18));
        pm.set(true, price);
        book.resolve(id);
        CallBook.Result memory r = book.getResult(id);
        assertLe(r.forfeit, r.bond);
        assertEq(book.claimableOf(id, alice) + book.claimableOf(id, t1), BOND);
    }
}
