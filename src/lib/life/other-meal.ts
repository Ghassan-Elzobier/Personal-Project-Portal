// "I ate something else": what to log when the owner ate, but not the meal that was
// planned (a friend cooked, a sandwich on the go, a meal out). The two honest
// choices used to be missing. Ticking the planned meal took a portion out of the
// fridge that was still there; "skipped" said nothing was eaten, which the weekly
// target check reads as under-eating. Logged as `swapped`, the planned portion
// stays where it is and the day still counts its food.
//
// The log is a rough size against the plan, on purpose: a quick, rough record that
// is kept beats a precise one that is dropped (Patel et al., JMIR Formative
// Research, 2022: a simple checklist was kept on 97% of days, full logging on 49%).
// Pure, with nothing imported, so the page can use the names without carrying the
// nutrition maths; and tested.

/** How the meal eaten compared with the one planned, as a share of it. */
export const OTHER_SIZES = { lighter: 0.6, about: 1, bigger: 1.4 } as const;
export type OtherSize = keyof typeof OTHER_SIZES;

export const isOtherSize = (value: unknown): value is OtherSize =>
  typeof value === "string" && Object.hasOwn(OTHER_SIZES, value);

/** What the three choices are called, on the page and in the log's note. */
export const OTHER_LABEL: Record<OtherSize, string> = {
  lighter: "Lighter",
  about: "About the plan",
  bigger: "Bigger",
};

/**
 * The energy and protein to log for a meal eaten in place of the planned one: the
 * planned meal's own figures times the size. A slot with no meal planned (eating
 * out, nothing planned) uses `slotShare` instead: that slot's share of the day's
 * targets. Protein is left out when there is nothing to estimate it from. The note
 * says it is a guess.
 */
export function otherMeal(
  size: OtherSize,
  planned: { kcal: number; protein: number } | null,
  slotShare: { kcal: number; protein: number | null },
): { kcal: number; protein: number | null; note: string } {
  const base = planned ?? slotShare;
  const within = (value: number, most: number) => Math.min(most, Math.max(0, Math.round(value)));
  return {
    kcal: within(base.kcal * OTHER_SIZES[size], 5000),
    protein: base.protein === null ? null : within(base.protein * OTHER_SIZES[size], 500),
    note: `Ate something else (${OTHER_LABEL[size].toLowerCase()}). An estimate.`,
  };
}
