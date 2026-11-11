"use client";
import { usePathname } from "next/navigation";

/** The short app footer. The landing page has its own. */
export default function Footer() {
  if (usePathname() === "/") return null;
  return (
    <footer className="footer">
      <div className="wrap">
        <p>Callout runs on the Somnia Tokyo testnet with paper money. A call is written on chain and cannot be changed after it is posted.</p>
      </div>
    </footer>
  );
}
