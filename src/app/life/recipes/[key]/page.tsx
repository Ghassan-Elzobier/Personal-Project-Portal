import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { TAG_LABELS } from "@/lib/life/allergens";
import { INGREDIENTS } from "@/lib/life/ingredients";
import { loadLife } from "@/lib/life/load";
import { portionMacros, verdict } from "@/lib/life/nutrition";
import { recipe } from "@/lib/life/recipes";
import { portionCost } from "@/lib/life/combo";
import { amount, money } from "@/lib/life/shopping";
import { recipeAmounts } from "@/lib/life/state";
import { Chip, ErrorNote } from "@/components/ui";
import { dayLabel, LifeHeader, Steps } from "../../parts";
import { RateRecipe } from "./rate";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: recipe(key)?.name ?? "Recipe" };
}

const SPICE = ["No heat", "Warm", "Medium", "Hot"];

/** "today", "tomorrow" or "on Saturday 21 Nov", to follow "The cook". */
function cookDay(date: string, today: string): string {
  const when = dayLabel(date, today);
  return ["Today", "Tomorrow", "Yesterday"].includes(when) ? when.toLowerCase() : `on ${when}`;
}

export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ portions?: string; cook?: string }>;
}) {
  const [, { key }, loaded] = await Promise.all([requireOwner(), params, loadLife()]);
  const r = recipe(key);
  if (!r) notFound();
  if (loaded.error !== undefined) return <ErrorNote message={loaded.error} />;
  const s = loaded.state;
  const v = verdict(r, s.profile.food);
  const ask = await searchParams;
  const { planned, scale, portions, lines, changed } = recipeAmounts(s, r, {
    cook: ask.cook,
    portions: ask.portions === undefined ? undefined : Number(ask.portions),
  });
  const per = portionMacros(r);
  const cookQuery = planned ? `cook=${encodeURIComponent(planned.cook.id)}&` : "";
  const rating = s.ratings.find((x) => x.recipe === r.key);

  return (
    <article className="space-y-6">
      <p>
        <Link href="/life/recipes" className="text-sm text-muted hover:text-white">
          ← Recipes
        </Link>
      </p>
      <LifeHeader eyebrow={`${r.cuisine} · ${r.totalMin} min, ${r.activeMin} hands-on`} title={r.name}>
        {r.blurb}
      </LifeHeader>

      <div className="flex flex-wrap gap-2">
        <Chip tone="mint">
          {Math.round(per.kcal * scale)} kcal · {Math.round(per.protein * scale)} g protein a portion
        </Chip>
        <Chip>About {money(portionCost(r, s.products, scale))} a portion</Chip>
        <Chip>{SPICE[r.spice]}</Chip>
        {r.keeps.freezes ? <Chip tone="ice">Freezes</Chip> : <Chip>Doesn&apos;t freeze</Chip>}
        <Chip>
          Fridge: {r.keeps.fridgeDays} {r.keeps.fridgeDays === 1 ? "day" : "days"}
        </Chip>
        {r.kit.map((k) => (
          <Chip key={k}>{k}</Chip>
        ))}
      </div>

      {!v.ok && <ErrorNote title="Not for you" message={v.blocked.map((b) => b.why).join(" ")} />}
      {(v.notes.length > 0 || (r.swaps?.length ?? 0) > 0) && (
        <section className="space-y-2 card-life" aria-labelledby="allergy-title">
          <h2 id="allergy-title" className="font-semibold">
            Your food rules
          </h2>
          <ul className="space-y-1 text-sm text-body">
            {r.swaps?.map((w) => (
              <li key={w}>· {w}</li>
            ))}
            {v.notes.map((n) => (
              <li key={n.tag + n.item} className="text-mint">
                · {n.why}
              </li>
            ))}
          </ul>
          {v.checks.length > 0 && (
            <p className="text-sm text-sand">
              Check the label of:{" "}
              {v.checks
                .map((c) => `${c.item.toLowerCase()} (${c.tags.map((t) => TAG_LABELS[t].split(" (")[0]).join(", ")})`)
                .join("; ")}
              .
            </p>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="space-y-3 card-life" aria-labelledby="ingredients-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ingredients-title" className="font-semibold">
              Ingredients
            </h2>
            <span className="flex items-center gap-1 text-sm">
              {[Math.max(1, portions - 1), portions + 1].map((n, i) => (
                <Link
                  key={i}
                  href={`/life/recipes/${r.key}?${cookQuery}portions=${n}`}
                  scroll={false}
                  className="tap h-9 min-w-9 rounded-lg bg-white/5 text-body"
                  aria-label={i === 0 ? "Fewer portions" : "More portions"}
                >
                  {i === 0 ? "−" : "+"}
                </Link>
              ))}
              <span className="ml-1 tabular-nums">{portions} portions</span>
            </span>
          </div>
          {planned ? (
            <p className={`text-xs ${changed ? "text-sand" : "text-muted"}`}>
              {changed
                ? `Changed from the ${planned.cook.portions} portions planned: these amounts no longer match your shopping list.`
                : `The cook ${cookDay(planned.cook.date, s.today)}: ${planned.cook.portions} portions, sized to your target${(planned.cook.round ?? 1) > 1 ? " and a little bigger to finish the packs" : ""}. These are the amounts your shopping list bought.`}
            </p>
          ) : (
            <p className="text-xs text-muted">
              Sized to your {s.kcal.toLocaleString("en-GB")} kcal target: {Math.round(scale * 100)}% of the written
              amounts.
            </p>
          )}
          <ul className="divide-y divide-white/5 text-sm">
            {lines.map((l, i) => {
              const ing = INGREDIENTS.get(l.item)!;
              const line = r.lines[i];
              return (
                <li key={i} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    {ing.name}
                    {line.note && <span className="text-muted">, {line.note}</span>}
                    {line.side && <span className="text-faint"> (to serve)</span>}
                  </span>
                  <span className="shrink-0 text-body tabular-nums">{amount(ing, l.qty)}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-3 card-life" aria-labelledby="method-title">
          <h2 id="method-title" className="font-semibold">
            Method
          </h2>
          <Steps steps={r.steps} />
          {r.reheat && <p className="rounded-xl bg-white/5 p-3 text-sm text-body">Reheat: {r.reheat}</p>}
          {r.keeps.rice && (
            <p className="text-xs text-sky-300">
              Rice: cool it within an hour, keep it in the fridge for one day at most, and reheat it once only (Food
              Standards Agency).
            </p>
          )}
        </section>
      </div>

      <RateRecipe
        key={r.key}
        recipe={r.key}
        stars={rating?.stars ?? null}
        note={rating?.note ?? ""}
        favourite={s.profile.favourites.includes(r.key)}
        hidden={s.profile.hidden.includes(r.key)}
      />
    </article>
  );
}
