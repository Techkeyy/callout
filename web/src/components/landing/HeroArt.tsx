"use client";
import Image from "next/image";
import { useEffect, useRef } from "react";

/**
 * The megaphone. The picture's own flat grey is #AAAAAA, the same as the hero band, so it is served as is
 * (not re-encoded) and blends with no seam. It drifts a little as the page scrolls, using transform only.
 */
export default function HeroArt() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = Math.min(window.scrollY, 900);
      el.style.transform = "translate3d(0," + (y * 0.14).toFixed(1) + "px,0) rotate(" + (y * 0.006).toFixed(2) + "deg)";
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div className="lh-art">
      <div ref={ref} className="lh-drift">
        <Image
          src="/hero-megaphone.jpg"
          alt="A hand holding a megaphone, printed in halftone"
          width={735}
          height={798}
          priority
          unoptimized
          sizes="(min-width: 900px) 50vw, 100vw"
          className="lh-img"
        />
      </div>
    </div>
  );
}
