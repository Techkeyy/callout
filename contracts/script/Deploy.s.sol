// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CallBook} from "../src/CallBook.sol";

contract Deploy is Script {
    address constant MARGIN_BANK = 0x478769E1177C0773c43A593DCCc4Ad15F15F1394;

    function run() external returns (CallBook book) {
        vm.startBroadcast();
        book = new CallBook(MARGIN_BANK);
        vm.stopBroadcast();
        console.log("CallBook deployed at:", address(book));
    }
}
