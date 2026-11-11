"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createWalletClient, custom, type WalletClient } from "viem";
import { somniaTokyo } from "./chain";

interface Eip1193 {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(ev: string, fn: (...a: never[]) => void): void;
  removeListener?(ev: string, fn: (...a: never[]) => void): void;
}
function provider(): Eip1193 | null {
  return typeof window === "undefined" ? null : ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null);
}

interface WalletCtx {
  address: `0x${string}` | null;
  hasWallet: boolean;
  wrongChain: boolean;
  connecting: boolean;
  connect(): Promise<void>;
  switchChain(): Promise<void>;
  /** Only valid when address is set. */
  client(): WalletClient | null;
}
const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [hasWallet, setHasWallet] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const p = provider();
    setHasWallet(!!p);
    if (!p) return;
    p.request({ method: "eth_accounts" })
      .then((a) => setAddress(((a as string[])[0] as `0x${string}`) ?? null))
      .catch(() => {});
    p.request({ method: "eth_chainId" })
      .then((c) => setChainId(parseInt(c as string, 16)))
      .catch(() => {});
    const onAcc = (a: string[]) => setAddress((a[0] as `0x${string}`) ?? null);
    const onChain = (c: string) => setChainId(parseInt(c, 16));
    p.on?.("accountsChanged", onAcc as never);
    p.on?.("chainChanged", onChain as never);
    return () => {
      p.removeListener?.("accountsChanged", onAcc as never);
      p.removeListener?.("chainChanged", onChain as never);
    };
  }, []);

  const connect = useCallback(async () => {
    const p = provider();
    if (!p) return;
    setConnecting(true);
    try {
      const a = (await p.request({ method: "eth_requestAccounts" })) as string[];
      setAddress((a[0] as `0x${string}`) ?? null);
      setChainId(parseInt((await p.request({ method: "eth_chainId" })) as string, 16));
    } catch {
      /* rejected: stay disconnected */
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchChain = useCallback(async () => {
    const p = provider();
    if (!p) return;
    const hex = `0x${somniaTokyo.id.toString(16)}`;
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if ((e as { code?: number }).code === 4001) return;
      try {
        await p.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hex,
              chainName: somniaTokyo.name,
              nativeCurrency: somniaTokyo.nativeCurrency,
              rpcUrls: [somniaTokyo.rpcUrls.default.http[0]],
              blockExplorerUrls: [somniaTokyo.blockExplorers.default.url],
            },
          ],
        });
      } catch {
        /* rejected */
      }
    }
  }, []);

  const value = useMemo<WalletCtx>(
    () => ({
      address,
      hasWallet,
      wrongChain: address !== null && chainId !== null && chainId !== somniaTokyo.id,
      connecting,
      connect,
      switchChain,
      client: () => {
        const p = provider();
        if (!p || !address) return null;
        return createWalletClient({ account: address, chain: somniaTokyo, transport: custom(p) });
      },
    }),
    [address, chainId, hasWallet, connecting, connect, switchChain],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("WalletProvider missing");
  return v;
}
