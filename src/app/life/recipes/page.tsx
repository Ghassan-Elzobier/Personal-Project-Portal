import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { loadLife } from "@/lib/life/load";
import { portionMacros, verdict } from "@/lib/life/nutrition";
import { RECIPES, type Cuisine } from "@/lib/life/recipes";
import { ErrorNote } from "@/components/ui";
import { Stars } from "../kit";
import { Chip, LifeHeader } from "../parts";

export const metadata: Metadata = { title: "Recipes" };
export const dynamic = "force-dynamic";

const FILTERS: (Cuisine | "All")[] = [
  "All",
  "Italian",
  "Middle Eastern",
  "Chinese & SE Asian",
  "Indian",
  "Caribbean & West African",
  "British & American",
  "Breakfast",
  "Shake",
];

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ cuisine?: string; all?: string }>;
}) {
  const [, params, loaded] = await Promise.all([requireOwner(), searchParams, loadLife()]);
  if (loaded.error !== undefined) {
    return (
      <div className="space-y-6">
        <LifeHeader title="Recipes" />
        <ErrorNote message={loaded.error} />
      </div>
    );
  }
  const s = loaded.state;
  const filter = FILTERS.includes(params.cuisine as Cuisine) ? (params.cuisine as Cuisine) : "All";
  const showAll = params.all === "1";
  const list = RECIPES.map((r) => ({
    r,
    v: verdict(r, s.profile.food),
    m: portionMacros(r),
    stars: s.ratings.find((x) => x.recipe === r.key)?.stars ?? null,
  }))
    .filter((x) => filter === "All" || x.r.cuisine === filter)
    .filter((x) => showAll || (x.v.ok && x.v.disliked.length === 0 && !s.profile.hidden.includes(x.r.key)));
  const hidden = RECIPES.filter(
    (r) =>
      (filter === "All" || r.cuisine === filter) &&
      (!verdict(r, s.profile.food).ok || s.profile.hidden.includes(r.key)),
  ).length;
  const href = (c: string, all = showAll) => {
    const q = new URLSearchParams();
    if (c !== "All") q.set("cuisine", c);
    if (all) q.set("all", "1");
    const text = q.toString();
    return `/life/recipes${text ? `?${text}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <LifeHeader eyebrow={`${list.length} recipes`} title="Recipes">
        Written for batch cooking on a bulk: big portions, lots of protein, and food that reheats well. Rate what you
        eat and the menu learns.
      </LifeHeader>
      <nav aria-label="Cuisine" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.map((c) => (
          <Link
            key={c}
            href={href(c)}
            aria-current={filter === c ? "page" : undefined}
            className={`chip shrink-0 px-3 py-1.5 text-sm ${filter === c ? "bg-mint/15 text-mint ring-mint/30" : "bg-white/5 text-neutral-300 ring-white/10"}`}
          >
            {c}
          </Link>
        ))}
      </nav>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map(({ r, v, m, stars }) => (
          <li key={r.key} className="min-w-0">
            <Link
              href={`/life/recipes/${r.key}`}
              className="block h-full space-y-2 card-life transition hover:ring-mint/30"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="min-w-0 font-semibold">{r.name}</h2>
                {stars ? <Stars value={stars} size="text-xs" /> : null}
              </div>
              <p className="text-sm text-neutral-300">{r.blurb}</p>
              <p className="text-xs text-neutral-400 tabular-nums">
                {r.cuisine} · {Math.round(m.kcal)} kcal · {Math.round(m.protein)} g protein · {r.totalMin} min
              </p>
              <div className="flex flex-wrap gap-1">
                {s.profile.favourites.includes(r.key) && <Chip tone="sand">Favourite</Chip>}
                {r.tags.includes("explore") && <Chip tone="aqua">A step further</Chip>}
                {r.tags.includes("weekend") && <Chip>Weekend</Chip>}
                {r.keeps.freezes && r.meal === "main" && <Chip tone="ice">Freezes</Chip>}
                {!v.ok && <Chip tone="coral">Not for you</Chip>}
                {s.profile.hidden.includes(r.key) && <Chip>Hidden</Chip>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="text-sm text-neutral-400">
          {hidden} {hidden === 1 ? "recipe is" : "recipes are"} hidden by your food rules or by you.{" "}
          <Link href={href(filter, !showAll)} className="text-mint hover:underline">
            {showAll ? "Hide them" : "Show them anyway"}
          </Link>
        </p>
      )}
    </div>
  );
}
