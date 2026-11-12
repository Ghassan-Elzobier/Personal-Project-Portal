"use client";

import { useState } from "react";
import { rate, setRecipePref } from "../../actions";
import { Stars, useAction } from "../../kit";

/**
 * Stars and a note, plus favourite and "not for me". The menu ranks by them: 4 and
 * 5 stars and favourites come round more, 1 and 2 rarely, hidden ones never.
 */
export function RateRecipe({ recipe, stars, note, favourite, hidden }: { recipe: string; stars: number | null; note: string; favourite: boolean; hidden: boolean }) {
  const [value, setValue] = useState(stars);
  const [text, setText] = useState(note);
  const [fav, setFav] = useState(favourite);
  const [off, setOff] = useState(hidden);
  const { pending, run } = useAction();
  return (
    <section className="card-life space-y-3" aria-labelledby="rate-title">
      <h2 id="rate-title" className="font-semibold">
        How was it?
      </h2>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={fav}
          disabled={pending}
          onClick={() => {
            const on = !fav;
            setFav(on);
            if (on) setOff(false);
            void run(() => setRecipePref(recipe, "favourites", on), on ? "A favourite: it'll come round more often." : "No longer a favourite.");
          }}
          className={`min-h-10 rounded-full px-4 text-sm ring-1 ${fav ? "bg-sand/15 text-sand ring-sand/40" : "bg-white/5 text-neutral-300 ring-white/10"}`}
        >
          {fav ? "★ Favourite" : "☆ Favourite"}
        </button>
        <button
          type="button"
          aria-pressed={off}
          disabled={pending}
          onClick={() => {
            const on = !off;
            setOff(on);
            if (on) setFav(false);
            void run(() => setRecipePref(recipe, "hidden", on), on ? "Hidden: it won't be suggested again." : "Back on the menu.");
          }}
          className={`min-h-10 rounded-full px-4 text-sm ring-1 ${off ? "bg-coral/15 text-coral ring-coral/40" : "bg-white/5 text-neutral-300 ring-white/10"}`}
        >
          {off ? "Hidden from my menu" : "Not for me"}
        </button>
      </div>
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
