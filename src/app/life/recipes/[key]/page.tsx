import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { TAG_LABELS } from "@/lib/life/allergens";
import { INGREDIENTS } from "@/lib/life/ingredients";
import { loadLife } from "@/lib/life/load";
import { portionMacros, portionScale, SPLIT, verdict } from "@/lib/life/nutrition";
import { cookScale } from "@/lib/life/planner";
import { recipe } from "@/lib/life/recipes";
import { amount, linesFor } from "@/lib/life/shopping";
import { ErrorNote } from "@/components/ui";
import { Chip, LifeHeader } from "../../parts";
import { RateRecipe } from "./rate";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: recipe(key)?.name ?? "Recipe" };
}

const SPICE = ["No heat", "Warm", "Medium", "Hot"];

export default async function RecipePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ portions?: string }> }) {
  await requireOwner();
  const { key } = await params;
  const r = recipe(key);
  if (!r) notFound();
  const loaded = await loadLife();
  if (loaded.error !== undefined) return <ErrorNote message={loaded.error} />;
  const s = loaded.state;
  const v = verdict(r, s.profile.food);
  const scale = r.meal === "main" ? cookScale(r, s.kcal) : portionScale(r, s.kcal * (r.meal === "shake" ? SPLIT.shake : SPLIT.breakfast));
  const wanted = Number((await searchParams).portions);
  const portions = Number.isInteger(wanted) && wanted >= 1 && wanted <= 20 ? wanted : r.portions;
  const per = portionMacros(r);
  const lines = linesFor(r, portions, scale);
  const rating = s.ratings.find((x) => x.recipe === r.key);

  return (
    <article className="space-y-6">
      <p>
        <Link href="/life/recipes" className="text-sm text-neutral-400 hover:text-white">
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
        <Chip>{SPICE[r.spice]}</Chip>
        {r.keeps.freezes ? <Chip tone="ice">Freezes</Chip> : <Chip>Doesn&apos;t freeze</Chip>}
        <Chip>
          Fridge: {r.keeps.fridgeDays} {r.keeps.fridgeDays === 1 ? "day" : "days"}
        </Chip>
        {r.kit.map((k) => (
          <Chip key={k}>{k}</Chip>
        ))}
      </div>

      {!v.ok && (
        <ErrorNote title="Not for you" message={v.blocked.map((b) => b.why).join(" ")} />
      )}
      {(v.notes.length > 0 || (r.swaps?.length ?? 0) > 0) && (
        <section className="card-life space-y-2" aria-labelledby="allergy-title">
          <h2 id="allergy-title" className="font-semibold">
            Your food rules
          </h2>
          <ul className="space-y-1 text-sm text-neutral-300">
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
              Check the label of: {v.checks.map((c) => `${c.item.toLowerCase()} (${c.tags.map((t) => TAG_LABELS[t].split(" (")[0]).join(", ")})`).join("; ")}.
            </p>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="card-life space-y-3" aria-labelledby="ingredients-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ingredients-title" className="font-semibold">
              Ingredients
            </h2>
            <span className="flex items-center gap-1 text-sm">
              {[Math.max(1, portions - 1), portions + 1].map((n, i) => (
                <Link key={i} href={`/life/recipes/${r.key}?portions=${n}`} scroll={false} className="tap h-9 min-w-9 rounded-lg bg-white/5 text-neutral-300" aria-label={i === 0 ? "Fewer portions" : "More portions"}>
                  {i === 0 ? "−" : "+"}
                </Link>
              ))}
              <span className="ml-1 tabular-nums">{portions} portions</span>
            </span>
          </div>
          <p className="text-xs text-neutral-400">Sized to your {s.kcal.toLocaleString("en-GB")} kcal target: {Math.round(scale * 100)}% of the written amounts.</p>
          <ul className="divide-y divide-white/5 text-sm">
            {lines.map((l, i) => {
              const ing = INGREDIENTS.get(l.item)!;
              const line = r.lines[i];
              return (
                <li key={i} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    {ing.name}
                    {line.note && <span className="text-neutral-400">, {line.note}</span>}
                    {line.side && <span className="text-neutral-500"> (to serve)</span>}
                  </span>
                  <span className="shrink-0 text-neutral-300 tabular-nums">{amount(ing, l.qty)}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card-life space-y-3" aria-labelledby="method-title">
          <h2 id="method-title" className="font-semibold">
            Method
          </h2>
          <ol className="space-y-3">
            {r.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mint/15 text-xs font-bold text-mint">{i + 1}</span>
                <span className="text-neutral-200">{step}</span>
              </li>
            ))}
          </ol>
          {r.reheat && <p className="rounded-xl bg-white/5 p-3 text-sm text-neutral-300">Reheat: {r.reheat}</p>}
          {r.keeps.rice && <p className="text-xs text-sky-300">Rice: cool it within an hour, keep it in the fridge for one day at most, and reheat it once only (Food Standards Agency).</p>}
        </section>
      </div>

      <RateRecipe recipe={r.key} stars={rating?.stars ?? null} note={rating?.note ?? ""} favourite={s.profile.favourites.includes(r.key)} hidden={s.profile.hidden.includes(r.key)} />
    </article>
  );
}
