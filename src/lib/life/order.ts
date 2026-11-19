// Ordering a week's list on Sainsbury's: what is left to add, the text for the app's
// SmartLists, and a price typed from the checkout. Sainsbury's has no API, so you
// add each product yourself; this keeps your place and the totals. No imports, so
// the phone's list can use it as you tick. Pure, so it is tested.

/** Lines still to add to the trolley, in list order: needed, not added yet, and not marked unavailable. */
export function toAdd<L extends { item: string; packs: number }>(lines: L[], ticked: string[], missing: string[]): L[] {
  return lines.filter((l) => l.packs > 0 && !ticked.includes(l.item) && !missing.includes(l.item));
}

/**
 * What is left, one line each for pasting into SmartLists in the Sainsbury's app:
 * "2 x Example Chicken Thighs 1kg". The packs come first and a picked product is
 * named exactly, so SmartLists finds that product; a line without one is named by
 * its ingredient and pack.
 */
export function smartList(
  lines: { item: string; packs: number; name: string; pack: string; product: { name: string } | null }[],
  ticked: string[],
  missing: string[],
): string {
  return toAdd(lines, ticked, missing)
    .map((l) => `${l.packs} x ${l.product ? l.product.name : `${l.name} (${l.pack})`}`)
    .join("\n");
}

/** "71.40", "£71.4" or "1,071" as pence; empty is null; anything else is undefined. */
export function parsePrice(text: string): number | null | undefined {
  const t = text.replace(/[£,\s]/g, "");
  if (!t) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return undefined;
  const [whole, part = ""] = t.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}
