// Wallet balances for the header menu: STT for gas, USDso in the wallet (bonds), and margin on
// dreamDEX's MarginBank (what a take uses). Each read fails on its own, so one slow source never
// blanks the others.
import { erc20Abi } from "./callbook";
import { publicClient } from "./calls";
import { makeMarkets } from "./dex";
import { settledOr, withTimeout } from "./take";

export const USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72" as const;
/** Lower case on purpose: the SDK rejects a checksummed MarginBank address. */
export const MARGIN_BANK = "0x478769e1177c0773c43a593dccc4ad15f15f1394" as const;

export interface Balances {
  stt: bigint | null;
  usdso: bigint | null;
  margin: bigint | null;
}

let fx: ReturnType<typeof makeMarkets> | null = null;

export async function readBalances(address: `0x${string}`): Promise<Balances> {
  fx ??= makeMarkets();
  const [stt, usdso, margin] = await Promise.allSettled([
    withTimeout(publicClient.getBalance({ address }), 8000),
    withTimeout(publicClient.readContract({ address: USDSO, abi: erc20Abi, functionName: "balanceOf", args: [address] }) as Promise<bigint>, 8000),
    withTimeout(
      fx.client.getMarginAccount(MARGIN_BANK, address).then((a) => BigInt(a.withdrawable)),
      10000,
    ),
  ]);
  return {
    stt: settledOr(stt, null),
    usdso: settledOr(usdso, null),
    margin: settledOr(margin, null),
  };
}
