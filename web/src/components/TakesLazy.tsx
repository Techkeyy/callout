"use client";
import dynamic from "next/dynamic";

// Takes scans the chain in the browser, so it loads after the page.
const Takes = dynamic(() => import("./Takes"), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: 120, marginBottom: "var(--s-8)" }} aria-label="Loading takes" />,
});

export default Takes;
