"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { readClaimable } from "@/lib/calls";
import { formatDisplay } from "@/lib/prices";

/** For the connected wallet only: what it can claim on a resolved call. Text, not a button, because the row is a link. */
export default function RowClaim({ id }: { id: string }) {
  const w = useWallet();
  const [amount, setAmount] = useState<bigint | null>(null);
  useEffect(() => {
    let alive = true;
    setAmount(null);
    if (w.address) readClaimable(BigInt(id), w.address).then((a) => alive && setAmount(a));
    return () => {
      alive = false;
    };
  }, [w.address, id]);
  if (!amount || amount <= 0n) return null;
  return <span className="row-claim num">You can claim {formatDisplay(amount, 2)} USDso</span>;
}
