import { expect, test } from "@playwright/test";
import { ownerDatabase } from "./owner-database";

// A gym block whose time went by with no session used to sit on Today as if it were
// still to come. Today now says it was missed and links to the gym page to train.
// The suite's clock is Monday 16 November 2026, 09:30: the first day of the week, so
// no earlier gym day can be carried (the unit tests cover that, in
// src/lib/portal/day-gym.test.ts). The test makes Monday a gym day at 06:00 for an
// hour with a made-up profile, clears any session an earlier save test left today,
// and puts the profile and that session back after.

test.setTimeout(90_000);

const TODAY = "2026-11-16";

type Session = { day: string; workout: string; finished: boolean; feel: number | null; notes: string };
type Set = {
  day: string;
  workout: string;
  exercise: string;
  position: number;
  kg: number;
  reps: number;
  rir: number | null;
};

test("a gym block that has ended with no session reads Missed on Today, and Train today opens the gym", async ({
  page,
}) => {
  const db = await ownerDatabase();
  const read = await db.call<{ profile: Record<string, unknown> | null; sessions: Session[]; sets: Set[] }>(
    "life_read",
    { p_since: TODAY },
  );
  const before = read.profile ?? {};
  const session = read.sessions.find((x) => x.day === TODAY);
  const sets = read.sets.filter((x) => x.day === TODAY);
  if (session) await db.call("gym_session", { p_day: TODAY, p_workout: session.workout, p_delete: true });
  const gym = (before.gym ?? {}) as Record<string, unknown>;
  await db.call("life_save_profile", {
    p_data: {
      ...before,
      gym: { ...gym, days: [0, 2, 4], start: 6 * 60, minutes: 60 },
      body: { ...((before.body as object) ?? {}), sex: "male", birthYear: 1990, heightCm: 175 },
    },
  });
  try {
    await page.goto("/");
    const yourDay = page.getByRole("region", { name: "Your day" });
    const row = yourDay.getByRole("listitem").filter({ hasText: /^06:00.*Gym:/ });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Missed", { exact: true })).toBeVisible();
    const train = row.getByRole("link", { name: "Train today" });
    await expect(train).toBeVisible();
    await train.click();
    await expect(page).toHaveURL(/\/life\/gym$/);
  } finally {
    await db.call("life_save_profile", { p_data: before });
    if (session) {
      for (const x of sets)
        await db.call("gym_log_set", {
          p_day: TODAY,
          p_workout: x.workout,
          p_exercise: x.exercise,
          p_position: x.position,
          p_kg: x.kg,
          p_reps: x.reps,
          p_rir: x.rir,
        });
      await db.call("gym_session", {
        p_day: TODAY,
        p_workout: session.workout,
        p_finished: session.finished,
        p_feel: session.feel,
        p_notes: session.notes,
      });
    }
  }
});
