import type { Metadata } from "next";
import { Suspense } from "react";
import AppTabs from "@/components/AppTabs";

export const metadata: Metadata = {
  title: "App",
  description: "Post a trade call with a bond behind it, or explore open calls and take one with the stop and target already set.",
};

export default function AppPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="skeleton" style={{ height: 320, marginTop: 32 }} aria-label="Loading" /></div>}>
      <AppTabs />
    </Suspense>
  );
}
