// Which set comes next in a gym session, so the page can name it and take you
// there. Most blocks are supersets ("alternate between these") with a card for
// each exercise, so the next set is rarely the next row: after bench set 1 it is
// dead bug set 1, on the card below, then bench set 2, back on the card above.
// Finding it by scrolling, between sets, with a minute or two of rest, is the
// cost this removes (interaction cost: Nielsen Norman Group). Pure, so it is tested.

/** A block of the session, in card order: each exercise and how many sets the plan asks of it. */
export type SetBlock = { superset: boolean; items: { key: string; sets: number }[] };

/** A logged set's id: the exercise and the set's number, as the session keeps them. */
export const setId = (key: string, position: number) => `${key}:${position}`;

/**
 * The next set to do, or null when every planned set is logged.
 *
 * It is in the first block that still has a planned set unlogged. In a superset it
 * is the exercise with the fewest sets logged, the earlier card on a tie, so the
 * two alternate. In a straight block it is the first exercise with a set left.
 * Either way it is that exercise's lowest-numbered set not yet logged. Sets added
 * beyond the plan don't count.
 */
export function nextSet(blocks: SetBlock[], logged: ReadonlySet<string>): { key: string; position: number } | null {
  for (const block of blocks) {
    const open = block.items
      .map((item) => {
        const positions = Array.from({ length: item.sets }, (_, i) => i + 1);
        const left = positions.filter((p) => !logged.has(setId(item.key, p)));
        return { key: item.key, done: positions.length - left.length, position: left[0] };
      })
      .filter((item) => item.position !== undefined);
    if (open.length === 0) continue;
    // The sort is stable, so the earlier card wins a tie.
    const pick = block.superset ? [...open].sort((a, b) => a.done - b.done)[0] : open[0];
    return { key: pick.key, position: pick.position };
  }
  return null;
}

/** What a set asks for, for the "Next: …" line: "Bench press · set 2 · 60 kg × 5", "Dead bug · set 1 · 8 reps". */
export function setLabel(
  item: { name: string; unit: "reps" | "s" | "m"; added: boolean; perSide: boolean },
  position: number,
  target: { kg: number | null; reps: number },
): string {
  const amount =
    item.unit === "reps" ? `${target.reps} ${target.reps === 1 ? "rep" : "reps"}` : `${target.reps} ${item.unit}`;
  const load =
    target.kg === null || target.kg === 0
      ? amount
      : `${item.added ? "+" : ""}${target.kg} kg × ${item.unit === "reps" ? target.reps : `${target.reps} ${item.unit}`}`;
  return `${item.name} · set ${position} · ${load}${item.perSide ? " a side" : ""}`;
}
