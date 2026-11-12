"use client";

import { useState } from "react";
import { rate } from "../../actions";
import { Stars, useAction } from "../../kit";

/** Stars and a note. The menu ranks by them: 4 and 5 come round more, 1 and 2 rarely. */
export function RateRecipe({ recipe, stars, note }: { recipe: string; stars: number | null; note: string }) {
  const [value, setValue] = useState(stars);
  const [text, setText] = useState(note);
  const { pending, run } = useAction();
  return (
    <section className="card-life space-y-3" aria-labelledby="rate-title">
      <h2 id="rate-title" className="font-semibold">
        How was it?
      </h2>
      <Stars
        value={value}
        onChange={(n) => {
          setValue(n);
          void run(() => rate(recipe, n, text || undefined), n ? "Thanks. The menu will take it into account." : "Rating cleared.");
        }}
        size="text-3xl"
      />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) void run(() => rate(recipe, value, text), "Note saved.");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Note for next time: less chilli, double the sauce…" className="field-input mt-0 min-w-0 flex-1" />
        <button type="submit" disabled={!value || pending} className="btn-soft">
          Save note
        </button>
      </form>
    </section>
  );
}
