// Shopping in person with the list: what is in the basket so far, against what the
// list costs and what the shop may spend. No imports, so the phone's list can use
// it as you tick. Pure, so it is tested.

export type BasketLine = { item: string; packs: number; pence: number };

export type Progress = {
  /** Lines picked up, and lines on the list (not counting ones the shop didn't have). */
  got: number;
  of: number;
  /** Pence picked up so far, and still to pick up. */
  pence: number;
  left: number;
  /** What this shop may still spend, when it has a budget: negative when over. */
  spare: number | null;
};

export function basketProgress(
  lines: BasketLine[],
  ticked: string[],
  missing: string[],
  budgetPence: number | null,
): Progress {
  const buying = lines.filter((l) => l.packs > 0 && !missing.includes(l.item));
  const got = buying.filter((l) => ticked.includes(l.item));
  const pence = got.reduce((t, l) => t + l.pence, 0);
  const total = buying.reduce((t, l) => t + l.pence, 0);
  return {
    got: got.length,
    of: buying.length,
    pence,
    left: total - pence,
    spare: budgetPence === null ? null : budgetPence - pence,
  };
}

/** The aisles a list needs, in store order: the only ones worth walking down. */
export function aislesToVisit<A extends string>(
  lines: { aisle: A; packs: number; item: string }[],
  order: A[],
  missing: string[],
): A[] {
  const wanted = new Set(lines.filter((l) => l.packs > 0 && !missing.includes(l.item)).map((l) => l.aisle));
  return order.filter((a) => wanted.has(a));
}

/** Pence as "£4.25". */
export function pounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

/** A tick, an untick, or "not found": the next lists, with an item never both. */
export function toggle(
  state: { ticked: string[]; missing: string[] },
  item: string,
  to: "got" | "missing" | "open",
): { ticked: string[]; missing: string[] } {
  const ticked = state.ticked.filter((x) => x !== item);
  const missing = state.missing.filter((x) => x !== item);
  if (to === "got") ticked.push(item);
  if (to === "missing") missing.push(item);
  return { ticked, missing };
}
