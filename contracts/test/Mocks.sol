// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISomniaReactivityPrecompile} from "reactivity/interfaces/ISomniaReactivityPrecompile.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external virtual returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

/// @dev Returns false instead of reverting.
contract FalseERC20 is MockERC20 {
    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }
}

/// @dev A hooked token: on transfer it calls back into the target (as an attacker would).
contract HookERC20 is MockERC20 {
    address public target;
    bytes public payload;
    bool public reentered;
    bool public reentryReverted;

    function arm(address t, bytes calldata p) external {
        target = t;
        payload = p;
    }

    function transfer(address to, uint256 amt) external override returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        if (target != address(0) && !reentered) {
            reentered = true;
            (bool ok,) = target.call(payload);
            reentryReverted = !ok;
        }
        return true;
    }
}

contract MockPool {
    bool public ok = true;
    uint256 public price;

    function set(bool ok_, uint256 price_) external {
        ok = ok_;
        price = price_;
    }

    function tryGetMarkPrice() external view returns (bool, uint256) {
        return (ok, price);
    }
}

contract MockBank {
    mapping(address => bool) public isPerpPoolRegistered;

    function register(address p) external {
        isPerpPoolRegistered[p] = true;
    }
}

contract MockPrecompile {
    uint256 public next = 100;
    ISomniaReactivityPrecompile.SubscriptionData private _last;

    function subscribe(ISomniaReactivityPrecompile.SubscriptionData calldata d) external returns (uint256) {
        _last = d;
        return ++next;
    }

    function last() external view returns (ISomniaReactivityPrecompile.SubscriptionData memory) {
        return _last;
    }
}
