import { defineChain } from "viem";

export const HTTP_URL = "https://api.hideki2.infra.testnet.somnia.network";
export const WS_URL = "wss://api.hideki2.infra.testnet.somnia.network/ws";
export const INDEXER_URL = "https://hideki-dev.smk.somnia.host/v1/graphql";
export const EXPLORER_URL = "https://explorer.testnet.somnia.network/tokyo";

export const somniaTokyo = defineChain({
  id: 50383,
  name: "Somnia Tokyo testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: [HTTP_URL], webSocket: [WS_URL] },
  },
  blockExplorers: {
    default: { name: "Somnia Explorer", url: EXPLORER_URL },
  },
  testnet: true,
});

export function txUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}
export function addressUrl(addr: string): string {
  return `${EXPLORER_URL}/address/${addr}`;
}
