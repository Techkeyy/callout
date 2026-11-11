"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Composer from "./Composer";
import ExploreFeed from "./ExploreFeed";

type Tab = "post" | "explore";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "post", label: "Post a call" },
  { id: "explore", label: "Explore" },
];

/** Two tabs on /app. The tab lives in the URL (?tab=explore). Both stay mounted once opened, so a half-written call survives a look around. */
export default function AppTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = params.get("tab") === "explore" ? "explore" : "post";
  const [visited, setVisited] = useState<Record<Tab, boolean>>({ post: true, explore: tab === "explore" });
  useEffect(() => setVisited((v) => (v[tab] ? v : { ...v, [tab]: true })), [tab]);
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ post: null, explore: null });

  const go = useCallback(
    (t: Tab) => {
      router.replace(t === "explore" ? pathname + "?tab=explore" : pathname, { scroll: false });
    },
    [router, pathname],
  );
  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next: Tab = tab === "post" ? "explore" : "post";
    go(next);
    refs.current[next]?.focus();
  }

  return (
    <div>
      <div className="wrap">
        <div className="tabs" role="tablist" aria-label="App sections" onKeyDown={onKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              role="tab"
              id={"tab-" + t.id}
              aria-selected={tab === t.id}
              aria-controls={"panel-" + t.id}
              tabIndex={tab === t.id ? 0 : -1}
              className="tab"
              onClick={() => go(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id="panel-post" aria-labelledby="tab-post" hidden={tab !== "post"}>
        <Composer />
      </div>
      <div role="tabpanel" id="panel-explore" aria-labelledby="tab-explore" hidden={tab !== "explore"}>
        {visited.explore && <ExploreFeed active={tab === "explore"} />}
      </div>
    </div>
  );
}
