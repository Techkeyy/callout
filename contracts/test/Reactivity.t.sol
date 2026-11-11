// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CallBook} from "../src/CallBook.sol";
import {ISomniaReactivityPrecompile} from "reactivity/interfaces/ISomniaReactivityPrecompile.sol";

contract MockPrecompile {
    ISomniaReactivityPrecompile.SubscriptionData private _last;

    function subscribe(ISomniaReactivityPrecompile.SubscriptionData calldata d) external returns (uint256) {
        _last = d;
        return 1;
    }

    function last() external view returns (ISomniaReactivityPrecompile.SubscriptionData memory) {
        return _last;
    }
}

contract ReactivityTest is Test {
    event TakeRecorded(uint256 indexed id, address indexed taker, uint256 amount);

    address constant BANK = 0x478769E1177C0773c43A593DCCc4Ad15F15F1394;
    address constant PRECOMPILE = address(0x0100);
    bytes32 constant TOPIC0 = keccak256("BuilderFeeCharged(address,address,address,uint256)");

    CallBook book;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address pool = makeAddr("pool");
    address pool2 = makeAddr("pool2");
    address payer1 = makeAddr("payer1");
    address payer2 = makeAddr("payer2");

    uint128 constant E = 100e18;
    uint128 constant UP = 120e18;
    uint128 constant DOWN = 90e18;

    function setUp() public {
        vm.warp(1_700_000_000);
        book = new CallBook(BANK);
    }

    function _post(address who, address p) internal returns (uint256) {
        vm.prank(who);
        return book.post(p, true, E, DOWN, UP, uint64(block.timestamp + 1 days), "t");
    }

    function _topics(address payer, address builder, address p) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](4);
        t[0] = TOPIC0;
        t[1] = bytes32(uint256(uint160(payer)));
        t[2] = bytes32(uint256(uint160(builder)));
        t[3] = bytes32(uint256(uint160(p)));
    }

    function _fire(address emitter, bytes32[] memory t, uint256 amount) internal {
        vm.prank(PRECOMPILE, address(book));
        book.onEvent(emitter, t, abi.encode(amount));
    }

    function _fill(address payer, uint256 amount) internal {
        _fire(BANK, _topics(payer, alice, pool), amount);
    }

    // ---- AlreadyOpen ----

    function test_alreadyOpen() public {
        _post(alice, pool);
        assertEq(book.openCallOf(alice, pool), 1);
        uint64 exp = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(CallBook.AlreadyOpen.selector);
        book.post(pool, true, E, DOWN, UP, exp, "again");
    }

    function test_openAgainAfterClose() public {
        _post(alice, pool);
        vm.prank(alice);
        book.close(1);
        assertEq(book.openCallOf(alice, pool), 0);
        assertEq(_post(alice, pool), 2);
        assertEq(book.openCallOf(alice, pool), 2);
    }

    function test_openAgainAfterExpiry() public {
        _post(alice, pool);
        vm.warp(block.timestamp + 1 days); // expiresAt == now counts as expired
        assertEq(book.openCallOf(alice, pool), 0);
        assertEq(_post(alice, pool), 2);
    }

    function test_differentPoolAndCallerAllowed() public {
        _post(alice, pool);
        assertEq(_post(alice, pool2), 2);
        assertEq(_post(bob, pool), 3);
        assertEq(book.openCallOf(alice, pool), 1);
        assertEq(book.openCallOf(alice, pool2), 2);
        assertEq(book.openCallOf(bob, pool), 3);
        assertEq(book.openCallOf(bob, pool2), 0);
    }

    // ---- handler ----

    function test_take_attributed() public {
        _post(alice, pool);
        vm.expectEmit(true, true, false, true);
        emit TakeRecorded(1, payer1, 5e18);
        _fill(payer1, 5e18);
        CallBook.Takes memory t = book.getTakes(1);
        assertEq(t.fills, 1);
        assertEq(t.takers, 1);
        assertEq(t.fees, 5e18);
        assertTrue(book.hasTaken(1, payer1));
        assertFalse(book.hasTaken(1, payer2));
    }

    function test_take_samePayerTwiceThenOther() public {
        _post(alice, pool);
        _fill(payer1, 1e18);
        _fill(payer1, 2e18);
        CallBook.Takes memory t = book.getTakes(1);
        assertEq(t.fills, 2);
        assertEq(t.takers, 1);
        assertEq(t.fees, 3e18);
        _fill(payer2, 4e18);
        t = book.getTakes(1);
        assertEq(t.fills, 3);
        assertEq(t.takers, 2);
        assertEq(t.fees, 7e18);
    }

    function test_take_noOpenCallIgnored() public {
        _fill(payer1, 1e18); // nothing posted yet, must not revert
        _post(alice, pool);
        _fire(BANK, _topics(payer1, bob, pool), 1e18); // bob has no call
        _fire(BANK, _topics(payer1, alice, pool2), 1e18); // alice has no call on pool2
        assertEq(book.getTakes(1).fills, 0);
    }

    function test_take_ignoredWhenFiltersFail() public {
        _post(alice, pool);
        _fire(makeAddr("evil"), _topics(payer1, alice, pool), 1e18); // wrong emitter
        bytes32[] memory t = _topics(payer1, alice, pool);
        t[0] = keccak256("Other()");
        _fire(BANK, t, 1e18); // wrong topic0
        bytes32[] memory s = new bytes32[](3);
        s[0] = TOPIC0;
        _fire(BANK, s, 1e18); // short topics
        vm.prank(PRECOMPILE, alice); // tx.origin != callbook
        book.onEvent(BANK, _topics(payer1, alice, pool), abi.encode(uint256(1e18)));
        vm.prank(PRECOMPILE, address(book)); // short data
        book.onEvent(BANK, _topics(payer1, alice, pool), "");
        assertEq(book.getTakes(1).fills, 0);
    }

    function test_take_onlyPrecompile() public {
        _post(alice, pool);
        bytes32[] memory t = _topics(payer1, alice, pool);
        bytes memory d = abi.encode(uint256(1));
        vm.prank(alice, address(book));
        vm.expectRevert(bytes4(keccak256("OnlyReactivityPrecompile()")));
        book.onEvent(BANK, t, d);
    }

    function test_take_closedOrExpiredIgnored() public {
        _post(alice, pool);
        vm.prank(alice);
        book.close(1);
        _fill(payer1, 1e18);
        assertEq(book.getTakes(1).fills, 0);

        _post(alice, pool); // id 2
        vm.warp(block.timestamp + 1 days);
        _fill(payer1, 1e18);
        assertEq(book.getTakes(2).fills, 0);
    }

    function test_getTakes_unknown() public {
        vm.expectRevert(CallBook.NoSuchCall.selector);
        book.getTakes(1);
    }

    function test_gas_onEvent() public {
        _post(alice, pool);
        bytes32[] memory t = _topics(payer1, alice, pool);
        bytes memory d = abi.encode(uint256(1e18));
        vm.startPrank(PRECOMPILE, address(book));
        uint256 g = gasleft();
        book.onEvent(BANK, t, d);
        emit log_named_uint("gas first take (new payer)", g - gasleft());
        g = gasleft();
        book.onEvent(BANK, t, d);
        emit log_named_uint("gas repeat take (same payer)", g - gasleft());
        vm.stopPrank();
    }

    // ---- watch ----

    function _etchMock() internal {
        vm.etch(PRECOMPILE, address(new MockPrecompile()).code);
        vm.deal(address(this), 40 ether);
    }

    function test_watch_needsBalance() public {
        _etchMock();
        vm.expectRevert(CallBook.NeedsBalance.selector);
        book.watch{value: 31 ether}();
        vm.expectRevert(CallBook.NeedsBalance.selector);
        book.watch();
    }

    function test_watch_succeedsAndOnlyOnce() public {
        _etchMock();
        book.watch{value: 32 ether}();
        assertEq(book.subscriptionId(), 1);
        assertEq(address(book).balance, 32 ether);

        ISomniaReactivityPrecompile.SubscriptionData memory d = MockPrecompile(PRECOMPILE).last();
        assertEq(d.emitter, BANK);
        assertEq(d.eventTopics[0], TOPIC0);
        assertEq(d.eventTopics[1], bytes32(0));
        assertEq(d.eventTopics[2], bytes32(0));
        assertEq(d.eventTopics[3], bytes32(0));
        assertEq(d.handlerContractAddress, address(book));
        assertEq(d.handlerFunctionSelector, bytes4(keccak256("onEvent(address,bytes32[],bytes)")));
        assertEq(d.gasLimit, 3_000_000);
        assertEq(d.maxFeePerGas, 20 gwei);
        assertEq(d.priorityFeePerGas, 0);
        assertEq(d.origin, address(0));
        assertEq(d.caller, address(0));
        assertTrue(d.isGuaranteed);
        assertFalse(d.isCoalesced);

        vm.expectRevert(CallBook.AlreadyWatching.selector);
        book.watch();
    }

    function test_watch_afterTopUp() public {
        _etchMock();
        (bool ok,) = address(book).call{value: 32 ether}("");
        assertTrue(ok);
        book.watch();
        assertEq(book.subscriptionId(), 1);
    }
}
