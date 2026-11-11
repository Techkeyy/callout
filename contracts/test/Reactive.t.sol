// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.sol";
import {CallBook} from "../src/CallBook.sol";
import {MockPrecompile} from "./Mocks.sol";
import {ISomniaReactivityPrecompile} from "reactivity/interfaces/ISomniaReactivityPrecompile.sol";

/// Takes from dreamDEX's builder-fee event, the capacity cover, and the expiry schedule.
contract ReactiveTest is Base {
    function test_takeCreditsCoveredNotional() public {
        uint256 id = _postLong();
        vm.expectEmit(true, true, false, true);
        emit TakeRecorded(id, t1, 1e18);
        _take(t1, 1_000e18);
        _take(t1, 500e18);
        _take(t2, 2_000e18);
        CallBook.Takes memory t = book.getTakes(id);
        assertEq(t.fills, 3);
        assertEq(t.takers, 2);
        assertEq(t.covered, 3_500e18);
        assertEq(t.fees, 3.5e18);
        assertEq(book.coveredOf(id, t1), 1_500e18);
    }

    /// Scale: takes past the capacity are not covered by the bond.
    function test_overCapacityNotCovered() public {
        uint256 id = _postLong();
        _take(t1, 4_000e18);
        vm.expectEmit(true, true, false, true);
        emit TakeOverCapacity(id, t2, 1_000e18);
        _take(t2, 2_000e18); // only 1,000 of room left
        _take(bob, 1_000e18); // no room at all
        assertEq(book.getTakes(id).covered, CAP);
        assertEq(book.coveredOf(id, t2), 1_000e18);
        assertEq(book.coveredOf(id, bob), 0);
        pm.set(true, DOWN);
        book.resolve(id);
        assertEq(book.claimableOf(id, t1), 80e18);
        assertEq(book.claimableOf(id, t2), 20e18);
        assertEq(book.claimableOf(id, bob), 0);
    }

    function test_takesIgnoredWhenNotOpen() public {
        uint256 id = _postLong();
        vm.prank(alice);
        book.close(id);
        _take(t1, 1_000e18);
        assertEq(book.getTakes(id).fills, 0);

        uint256 id2 = _postLong(); // repost after close is a new call
        vm.warp(block.timestamp + 1 days); // expired
        _take(t1, 1_000e18);
        assertEq(book.getTakes(id2).fills, 0);
    }

    function test_takesIgnoredFromWrongSender() public {
        uint256 id = _postLong();
        bytes32[] memory t = new bytes32[](4);
        t[0] = TOPIC0;
        t[1] = bytes32(uint256(uint160(t1)));
        t[2] = bytes32(uint256(uint160(alice)));
        t[3] = bytes32(uint256(uint160(pool)));
        // not the precompile
        vm.prank(rando);
        vm.expectRevert();
        book.onEvent(address(bank), t, abi.encode(uint256(1e18)));
        // wrong emitter
        vm.prank(PRECOMPILE, address(book));
        book.onEvent(rando, t, abi.encode(uint256(1e18)));
        // wrong tx.origin
        vm.prank(PRECOMPILE, rando);
        book.onEvent(address(bank), t, abi.encode(uint256(1e18)));
        assertEq(book.getTakes(id).fills, 0);
    }

    function test_takeOnOtherMarketNotCredited() public {
        uint256 id = _postLong();
        _takeOn(t1, alice, pool2, 1_000e18);
        assertEq(book.getTakes(id).fills, 0);
    }

    // ---- the expiry schedule ----

    function test_noScheduleWithoutReserve() public {
        uint256 id = _postLong();
        assertEq(book.expirySubscriptionOf(id), 0);
    }

    function test_scheduleCreatedWithReserve() public {
        vm.deal(address(book), 33 ether);
        uint256 id = _postLong();
        assertGt(book.expirySubscriptionOf(id), 0);
        ISomniaReactivityPrecompile.SubscriptionData memory d = MockPrecompile(PRECOMPILE).last();
        assertEq(d.eventTopics[0], SCHEDULE);
        assertEq(uint256(d.eventTopics[1]), uint256(_exp()) * 1000 + (id % 1000));
        assertEq(d.emitter, PRECOMPILE);
        assertEq(d.handlerContractAddress, address(book));
    }

    /// The chain settles the call at expiry; nobody has to remember to resolve.
    function test_scheduleSettlesAtExpiry() public {
        vm.deal(address(book), 33 ether);
        uint256 id = _postLong();
        uint64 exp = book.getCall(id).expiresAt;
        _take(t1, 1_000e18);
        vm.warp(exp);
        pm.set(true, 95e18);
        _fireSchedule(uint256(exp) * 1000 + (id % 1000));
        assertEq(_outcome(id), 3);
        assertEq(book.getResult(id).forfeit, 50e18);
    }

    function test_scheduleStalePriceLeavesItOpenForManualResolve() public {
        vm.deal(address(book), 33 ether);
        uint256 id = _postLong();
        uint64 exp = book.getCall(id).expiresAt;
        vm.warp(exp);
        pm.set(false, 0);
        _fireSchedule(uint256(exp) * 1000 + (id % 1000)); // must not revert
        assertEq(_outcome(id), 0);
        pm.set(true, 101e18);
        book.resolve(id);
        assertEq(_outcome(id), 3);
    }

    function test_scheduleForUnknownOrSettledIsNoop() public {
        vm.deal(address(book), 33 ether);
        uint256 id = _postLong();
        uint64 exp = book.getCall(id).expiresAt;
        _fireSchedule(123); // unknown
        pm.set(true, UP);
        book.resolve(id);
        vm.warp(exp);
        pm.set(true, DOWN);
        _fireSchedule(uint256(exp) * 1000 + (id % 1000));
        assertEq(_outcome(id), 1); // still HIT
    }

    function test_scheduleFromWrongEmitterIgnored() public {
        vm.deal(address(book), 33 ether);
        uint256 id = _postLong();
        uint64 exp = book.getCall(id).expiresAt;
        vm.warp(exp);
        bytes32[] memory t = new bytes32[](2);
        t[0] = SCHEDULE;
        t[1] = bytes32(uint256(exp) * 1000 + (id % 1000));
        vm.prank(PRECOMPILE, address(book));
        book.onEvent(rando, t, "");
        assertEq(_outcome(id), 0);
    }

    function test_watchNeedsReserveAndOnce() public {
        vm.expectRevert(CallBook.NeedsBalance.selector);
        book.watch();
        vm.deal(address(book), 32 ether);
        book.watch();
        vm.expectRevert(CallBook.AlreadyWatching.selector);
        book.watch();
    }
}
