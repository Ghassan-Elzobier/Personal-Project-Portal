"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "@/components/toaster";

// Small client pieces the Life pages share: a button that runs an action and
// says what happened, a bottom sheet, and star ratings.

type Outcome = { error?: string } | void;

/** Runs a server action, shows its error as a toast, and returns whether it worked. */
export function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Outcome>, done?: string) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const result = await fn();
        if (result && "error" in result && result.error) {
          toast(result.error, { tone: "error" });
          resolve(false);
        } else {
          if (done) toast(done);
          resolve(true);
        }
      }),
    );
  return { pending, run };
}

export function ActionButton({
  action,
  done,
  children,
  className = "btn-soft",
  confirm,
  disabled,
  label,
}: {
  action: () => Promise<Outcome>;
  done?: string;
  children: ReactNode;
  className?: string;
  confirm?: string;
  disabled?: boolean;
  label?: string;
}) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      aria-label={label}
      disabled={pending || disabled}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        void run(action, done);
      }}
      className={`${className} ${pending ? "opacity-60" : ""}`}
    >
      {children}
    </button>
  );
}

/** A native dialog: a bottom sheet on phones, a centred panel on wider screens. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="tap -mt-2 -mr-2 text-2xl leading-none text-neutral-400 hover:text-white" aria-label="Close">
          ×
        </button>
      </div>
      {open && children}
    </dialog>
  );
}

export function Stars({ value, onChange, size = "text-xl" }: { value: number | null; onChange?: (stars: number | null) => void; size?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <span className="inline-flex" role={onChange ? "radiogroup" : "img"} aria-label={value ? `${value} of 5 stars` : "Not rated"}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onChange(value === n ? null : n)}
            className={`tap min-w-9 ${size} ${n <= shown ? "text-sand" : "text-white/20"}`}
          >
            ★
          </button>
        ) : (
          <span key={n} className={`${size} ${n <= shown ? "text-sand" : "text-white/20"}`} aria-hidden>
            ★
          </span>
        ),
      )}
    </span>
  );
}
