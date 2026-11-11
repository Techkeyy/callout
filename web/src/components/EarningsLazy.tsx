"use client";
import dynamic from "next/dynamic";

// Earnings uses the markets SDK, so it loads in the browser only.
const Earnings = dynamic(() => import("./Earnings"), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: 120, marginBottom: "var(--s-8)" }} aria-label="Loading earnings" />,
});

export default Earnings;
