// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.sol";
import {CallBook} from "../src/CallBook.sol";
import {FalseERC20, HookERC20} from "./Mocks.sol";

/// Money-holding basics: reentrancy, checked transfers, the steward's limited power.
contract SafetyTest is Base {
    function test_reentrancy_claimCannotReenter() public {
        HookERC20 hook = new HookERC20();
        CallBook b = new CallBook(address(bank), address(hook), MIN_BOND, steward);
        hook.mint(alice, 1_000e18);
        vm.prank(alice);
        hook.approve(address(b), type(uint256).max);
        vm.prank(alice);
        uint256 id = b.post(pool, true, E, DOWN, UP, _exp(), "x", CAP, BOND);
        pm.set(true, UP);
        b.resolve(id);
        // the token calls claim() again from inside the payout transfer
        hook.arm(address(b), abi.encodeCall(CallBook.claim, (id)));
        vm.prank(alice);
        b.claim(id);
        assertTrue(hook.reentered());
        assertTrue(hook.reentryReverted());
        assertEq(hook.balanceOf(address(b)), 0);
    }

    function test_transferReturningFalseReverts() public {
        FalseERC20 ft = new FalseERC20();
        CallBook b = new CallBook(address(bank), address(ft), MIN_BOND, steward);
        ft.mint(alice, 1_000e18);
        vm.prank(alice);
        ft.approve(address(b), type(uint256).max);
        vm.prank(alice);
        uint256 id = b.post(pool, true, E, DOWN, UP, _exp(), "x", CAP, BOND);
        pm.set(true, UP);
        b.resolve(id);
        vm.prank(alice);
        vm.expectRevert(CallBook.TransferFailed.selector);
        b.claim(id);
    }

    function test_postNeedsAllowance() public {
        vm.prank(alice);
        token.approve(address(book), 0);
        vm.prank(alice);
        vm.expectRevert();
        book.post(pool, true, E, DOWN, UP, _exp(), "x", CAP, BOND);
    }

    function test_steward_onlyMovesNativeReserve() public {
        vm.deal(address(book), 40 ether);
        _postLong();
        vm.prank(rando);
        vm.expectRevert(CallBook.NotSteward.selector);
        book.withdrawReserve(payable(rando), 1 ether);
        vm.prank(steward);
        book.withdrawReserve(payable(steward), 8 ether);
        assertEq(steward.balance, 8 ether);
        assertEq(address(book).balance, 32 ether);
        assertEq(token.balanceOf(address(book)), BOND); // bonds untouched
    }
}
