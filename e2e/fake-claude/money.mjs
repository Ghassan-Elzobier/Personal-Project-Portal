// Suggesting categories for unsorted merchants (src/lib/money/suggest.ts). It answers as
// Claude would from the names alone: a bakehouse is Groceries, a climbing wall is Fun and
// social, and anything else is left for the owner (e2e/state-money-suggest.spec.ts).

const PLACES = [
  { word: "BAKEHOUSE", category: "Groceries" },
  { word: "CLIMBING", category: "Fun and social" },
];

export const matches = (body) => "suggestions" in (body.output_config?.format?.schema?.properties ?? {});

const block = (user, tag) => new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(user)?.[1]?.split("\n") ?? [];

export function answer(user) {
  const categories = block(user, "categories")
    .map((line) => /^C(\d+)\| (.*) \(([a-z]+)\)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ id: Number(m[1]), name: m[2] }));
  const suggestions = block(user, "merchants")
    .map((line) => /^M(\d+)\| (.*) — money (out|in)$/.exec(line))
    .filter(Boolean)
    .flatMap((m) => {
      const place = PLACES.find((p) => m[2].toUpperCase().includes(p.word));
      const category = place && categories.find((c) => c.name === place.category);
      return category ? [{ merchant: Number(m[1]), category: category.id }] : [];
    });
  return { suggestions };
}
