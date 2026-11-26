import { expect, test } from "@playwright/test";
import { connectClaude } from "./connector";
import { ownerDatabase } from "./owner-database";

// On an assisted pull-up machine the help is logged as negative kg: telling Claude
// "35 kg of help" saves -35. Only a bodyweight move takes help, so a bench set
// below zero is refused. The test logs through Claude's tools and takes the set,
// and a session it started, off again through the database.

test.setTimeout(90_000);

/** The suite's pinned day: a Monday, and a gym day. */
const TODAY = "2026-11-16";

test("Claude logs an assisted pull-up's help as negative kg, and refuses help on a barbell lift", async ({
  page,
  request,
}) => {
  const db = await ownerDatabase();
  const sessions = async () =>
    (await db.call<{ sessions: { day: string; workout: string }[] }>("life_read", { p_since: TODAY })).sessions;
  const had = (await sessions()).some((s) => s.day === TODAY);
  const claude = await connectClaude(page, request);
  try {
    const saved = await claude.call("log_gym_set", { exercise: "pull-up", position: 1, kg: -35, reps: 8, date: TODAY });
    expect(saved.isError, saved.text).toBe(false);
    expect(JSON.parse(saved.text).logged.kg).toBe(-35);
    const sets = (
      await db.call<{ sets: { day: string; exercise: string; kg: number }[] }>("life_read", { p_since: TODAY })
    ).sets;
    expect(sets.find((s) => s.day === TODAY && s.exercise === "pull-up")?.kg).toBe(-35);

    const bench = await claude.call("log_gym_set", { exercise: "bench", position: 9, kg: -20, reps: 5, date: TODAY });
    expect(bench.isError, "only a bodyweight move takes help").toBe(true);
  } finally {
    // Back as it was: the set comes off, and the day's session too if this test started it.
    const workout = (await sessions()).find((s) => s.day === TODAY)?.workout ?? "A";
    await db.call("gym_log_set", {
      p_day: TODAY,
      p_workout: workout,
      p_exercise: "pull-up",
      p_position: 1,
      p_kg: null,
      p_reps: null,
    });
    if (!had) await db.call("gym_session", { p_day: TODAY, p_workout: workout, p_delete: true });
    await claude.disconnect();
  }
});
