"use client";
import { useWallet } from "@/lib/wallet";
import ShareLauncher from "./ShareLauncher";

/** "Share my record" on the connected wallet's own page, "Share this record" on anyone else's. The card loads when the button is pressed. */
export default function RecordShare({ address }: { address: string }) {
  const w = useWallet();
  const mine = !!w.address && w.address.toLowerCase() === address.toLowerCase();
  return <ShareLauncher label={mine ? "Share my record" : "Share this record"} title={mine ? "Share my record" : "Share this record"} intro="Every call is on chain. Nobody can edit it." modelUrl={`/api/card/record/${address}`} primary={mine} />;
}
