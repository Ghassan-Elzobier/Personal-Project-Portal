"use client";

import { useEffect, useState } from "react";

type Toast = { id: number; message: string; tone: "info" | "error"; action?: { label: string; onClick: () => void } };

const EVENT = "portal:toast";
let nextId = 1;

/** Shows a short message. An action, such as Undo, stays available for a few seconds. */
export function toast(message: string, options: { tone?: Toast["tone"]; action?: Toast["action"] } = {}) {
  const detail: Toast = { id: nextId++, message, tone: options.tone ?? "info", action: options.action };
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setToasts((list) => [...list.slice(-2), t]);
      window.setTimeout(
        () => setToasts((list) => list.filter((x) => x.id !== t.id)),
        t.action || t.tone === "error" ? 7000 : 3500,
      );
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
      aria-live="polite"
      role="status"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-md items-center gap-4 rounded-xl bg-navy px-4 py-3 text-sm shadow-2xl ring-1 ${t.tone === "error" ? "text-coral ring-coral/40" : "ring-white/15"}`}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              className="cursor-pointer font-semibold link"
              onClick={() => {
                t.action!.onClick();
                setToasts((list) => list.filter((x) => x.id !== t.id));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
