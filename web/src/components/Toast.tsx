"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { txUrl } from "@/lib/chain";

export type ToastTone = "pending" | "ok" | "warn" | "info";
export interface ToastData {
  id: number;
  tone: ToastTone;
  text: string;
  hash?: string;
}

export interface ToastApi {
  /** Show a toast and get its id. A pending toast stays until it is updated or dismissed. */
  show(t: Omit<ToastData, "id">): number;
  update(id: number, t: Partial<Omit<ToastData, "id">>): void;
  dismiss(id: number): void;
}

const Ctx = createContext<ToastApi | null>(null);
const LIFETIME: Record<ToastTone, number> = { pending: 0, ok: 7000, info: 5000, warn: 10000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastData[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((cur) => cur.filter((x) => x.id !== id));
  }, []);
  const arm = useCallback(
    (id: number, tone: ToastTone) => {
      const old = timers.current.get(id);
      if (old) clearTimeout(old);
      timers.current.delete(id);
      if (LIFETIME[tone] > 0) timers.current.set(id, setTimeout(() => dismiss(id), LIFETIME[tone]));
    },
    [dismiss],
  );
  const show = useCallback(
    (t: Omit<ToastData, "id">) => {
      const id = ++seq.current;
      setItems((cur) => [...cur.slice(-3), { ...t, id }]);
      arm(id, t.tone);
      return id;
    },
    [arm],
  );
  const update = useCallback(
    (id: number, t: Partial<Omit<ToastData, "id">>) => {
      setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...t } : x)));
      if (t.tone) arm(id, t.tone);
    },
    [arm],
  );
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);
  const api = useMemo(() => ({ show, update, dismiss }), [show, update, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className={`toast is-${t.tone}`} role={t.tone === "warn" ? "alert" : "status"}>
            <span className="toast-mark" aria-hidden="true">
              {t.tone === "pending" ? <span className="toast-spin" /> : t.tone === "ok" ? "✓" : t.tone === "warn" ? "!" : "i"}
            </span>
            <p className="toast-text">
              {t.text}
              {t.hash && (
                <>
                  {" "}
                  <a href={txUrl(t.hash)} target="_blank" rel="noopener noreferrer">
                    View transaction
                  </a>
                </>
              )}
            </p>
            <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              &times;
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

const NOOP: ToastApi = { show: () => 0, update: () => {}, dismiss: () => {} };
export function useToast(): ToastApi {
  return useContext(Ctx) ?? NOOP;
}
