"use client";

import { CopyButton } from "@/components/copy-button";

export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={value}
        aria-label={label}
        className="field-input font-mono text-sm"
        onFocus={(e) => e.target.select()}
      />
      <CopyButton value={value} />
    </div>
  );
}
