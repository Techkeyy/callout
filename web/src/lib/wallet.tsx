"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createWalletClient, custom, type WalletClient } from "viem";
import { somniaTokyo } from "./chain";

interface Eip1193 {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(ev: string, fn: (...a: never[]) => void): void;
  removeListener?(ev: string, fn: (...a: never[]) => void): void;
}

interface Found {
  id: string;
  name: string;
  provider: Eip1193;
}

export interface WalletChoice {
  id: string;
  name: string;
}

interface WalletCtx {
  address: `0x${string}` | null;
  hasWallet: boolean;
  /** Every wallet found so far (EIP-6963 announcements plus window.ethereum). */
  choices: WalletChoice[];
  wrongChain: boolean;
  connecting: boolean;
  /** True after a connect click when no wallet was found. */
  noWallet: boolean;
  /** Connect the wallet with this id, or the first one found. Re-checks for late wallets first. */
  connect(id?: string): Promise<void>;
  switchChain(): Promise<void>;
  /** Forget the connection here, and ask the wallet to revoke access where it supports that. */
  disconnect(): Promise<void>;
  /** Re-scan for wallets, e.g. after one injects late. */
  rescan(): void;
  /** Only valid when address is set. */
  client(): WalletClient | null;
}
const Ctx = createContext<WalletCtx | null>(null);

/** Set when the user disconnects, so the page does not silently reconnect on the next visit. */
const DISCONNECTED_KEY = "callout:disconnected";
const isDisconnected = () => {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(DISCONNECTED_KEY) === "1";
  } catch {
    return false;
  }
};
const setDisconnected = (v: boolean) => {
  try {
    if (v) window.localStorage.setItem(DISCONNECTED_KEY, "1");
    else window.localStorage.removeItem(DISCONNECTED_KEY);
  } catch {
    /* storage blocked: the flag is a convenience only */
  }
};

function injected(): Eip1193 | null {
  return typeof window === "undefined" ? null : ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [found, setFound] = useState<Found[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [noWallet, setNoWallet] = useState(false);
  const foundRef = useRef<Found[]>([]);
  foundRef.current = found;

  const add = useCallback((f: Found) => {
    setFound((cur) => {
      if (cur.some((c) => c.id === f.id || c.provider === f.provider)) return cur;
      const next = [...cur, f];
      foundRef.current = next;
      return next;
    });
  }, []);

  /** Ask for EIP-6963 announcements and pick up window.ethereum as a fallback. */
  const rescan = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const eth = injected();
    if (eth) add({ id: "injected", name: "Browser wallet", provider: eth });
  }, [add]);

  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<{ info?: { uuid?: string; name?: string }; provider?: Eip1193 }>).detail;
      if (d?.provider && d.info?.uuid) add({ id: d.info.uuid, name: d.info.name ?? "Wallet", provider: d.provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    const onFocus = () => rescan();
    window.addEventListener("focus", onFocus);
    rescan();
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.removeEventListener("focus", onFocus);
    };
  }, [add, rescan]);

  // The wallet in use: the one the user picked, else the first found. A real EIP-6963 wallet beats the generic window.ethereum.
  const active = useMemo(() => {
    const byId = found.find((f) => f.id === selectedId);
    if (byId) return byId;
    return found.find((f) => f.id !== "injected") ?? found[0] ?? null;
  }, [found, selectedId]);
  const activeRef = useRef<Found | null>(null);
  activeRef.current = active;

  // Follow the active wallet's accounts and network.
  useEffect(() => {
    const p = active?.provider;
    if (!p) return;
    let alive = true;
    if (!isDisconnected())
      p.request({ method: "eth_accounts" })
        .then((a) => alive && setAddress(((a as string[])[0] as `0x${string}`) ?? null))
        .catch(() => {});
    p.request({ method: "eth_chainId" })
      .then((c) => alive && setChainId(parseInt(c as string, 16)))
      .catch(() => {});
    const onAcc = (a: string[]) => {
      if (!isDisconnected()) setAddress((a[0] as `0x${string}`) ?? null);
    };
    const onChain = (c: string) => setChainId(parseInt(c, 16));
    p.on?.("accountsChanged", onAcc as never);
    p.on?.("chainChanged", onChain as never);
    return () => {
      alive = false;
      p.removeListener?.("accountsChanged", onAcc as never);
      p.removeListener?.("chainChanged", onChain as never);
    };
  }, [active]);

  const connect = useCallback(
    async (id?: string) => {
      rescan(); // a wallet may have injected since the page loaded
      const list = foundRef.current;
      const pick = (id ? list.find((f) => f.id === id) : null) ?? activeRef.current ?? list[0] ?? null;
      const p = pick?.provider ?? injected();
      if (!p) {
        setNoWallet(true);
        return;
      }
      setNoWallet(false);
      setDisconnected(false);
      if (pick) setSelectedId(pick.id);
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
    },
    [rescan],
  );

  const switchChain = useCallback(async () => {
    const p = activeRef.current?.provider ?? injected();
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

  const disconnect = useCallback(async () => {
    setDisconnected(true);
    setAddress(null);
    const p = activeRef.current?.provider ?? injected();
    try {
      // Supported by MetaMask and others; wallets without it simply keep their own permission list.
      await p?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      /* not supported: the app has still forgotten the connection */
    }
  }, []);

  const value = useMemo<WalletCtx>(
    () => ({
      address,
      hasWallet: found.length > 0,
      choices: found.map((f) => ({ id: f.id, name: f.name })),
      wrongChain: address !== null && chainId !== null && chainId !== somniaTokyo.id,
      connecting,
      noWallet,
      connect,
      switchChain,
      disconnect,
      rescan,
      client: () => {
        const p = activeRef.current?.provider ?? injected();
        if (!p || !address) return null;
        return createWalletClient({ account: address, chain: somniaTokyo, transport: custom(p) });
      },
    }),
    [address, chainId, found, connecting, noWallet, connect, switchChain, disconnect, rescan],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("WalletProvider missing");
  return v;
}
