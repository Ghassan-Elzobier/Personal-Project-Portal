// What one pack holds: read from a Sainsbury's link, and checked against how the
// ingredient is counted. Pure and free of the ingredient list, so the product form
// can use it in the browser.

import type { Ingredient, Unit } from "./ingredients.ts";

type Counted = Pick<Ingredient, "unit" | "each">;

/** The units a pack can be given in: the ones the ingredient's amounts convert to. */
export function packUnits(item: Counted): Unit[] {
  if (item.each) return ["g", "ml", "each"];
  return item.unit === "each" ? ["each"] : ["g", "ml"];
}

/** Why this pack size can't be used for the ingredient, or null when it can. */
export function packProblem(item: Counted, qty: number, unit: Unit): string | null {
  if (!(qty > 0) || !Number.isFinite(qty)) return "Give the pack size.";
  if (packUnits(item).includes(unit)) return null;
  return item.unit === "each"
    ? "This is counted one by one: give the pack in each."
    : "This is counted by weight: give the pack in g or ml.";
}

/**
 * The size a product's own link gives when the saved pack disagrees with it, so a
 * pack typed or read wrongly (27 l of milk) is caught before it fills the kitchen.
 */
export function linkDisagrees(
  item: Counted,
  product: { url: string; packQty: number; packUnit: Unit },
): { qty: number; unit: Unit } | null {
  const linked = packFromSlug(product.url);
  if (!linked || !packUnits(item).includes(linked.unit)) return null;
  const same = linked.unit === product.packUnit && Math.abs(linked.qty - product.packQty) <= linked.qty * 0.05;
  return same ? null : linked;
}

/**
 * Pack size from a Sainsbury's product slug like "...-thigh-fillets-1kg", "...-x6",
 * or "...-whole-milk-2-27l". The slug writes a decimal point as a hyphen, so
 * "2-27l" is 2.27 litres and "1-5kg" is 1.5 kg.
 */
export function packFromSlug(url: string): { qty: number; unit: Unit } | null {
  const slug = url.split(/[?#]/)[0].split("/").pop()?.toLowerCase() ?? "";
  const decimal = /(?:^|-)(\d{1,2})-(\d{1,3})(kg|l|litre|litres)(?:-|$)/.exec(slug);
  const whole = /(?:^|-)(\d+(?:\.\d+)?)(kg|g|ml|l|litre|litres)(?:-|$)/.exec(slug);
  const weight = decimal
    ? { n: Number(`${decimal[1]}.${decimal[2]}`), u: decimal[3] }
    : whole && { n: Number(whole[1]), u: whole[2] };
  if (weight) {
    const { n, u } = weight;
    if (u === "kg") return { qty: Math.round(n * 1000), unit: "g" };
    if (u === "g") return { qty: n, unit: "g" };
    if (u === "ml") return { qty: n, unit: "ml" };
    return { qty: Math.round(n * 1000), unit: "ml" };
  }
  const count = /(?:^|-)x?(\d{1,2})(?:-?pack|-?pk)?(?:-|$)/.exec(slug.replace(/-(\d+)-pack/, "-x$1"));
  if (count && /x\d|pack|pk/.test(slug)) return { qty: Number(count[1]), unit: "each" };
  return null;
}
