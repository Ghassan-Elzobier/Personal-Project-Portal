import "server-only";
import { clock } from "../dates/week";
import { resolve, workout } from "./gym/program";
import { demoFor } from "./gym/media";
import { nextWorkout, target } from "./gym/progress";
import { lifeToday, loadLife } from "./load";
import type { Slot } from "./nutrition";
import * as ops from "./operations";
import { recipe } from "./recipes";
import { isReturning, placedMacros, routineFor } from "./state";

// Life tools for the Claude connector: what today holds, and one-line logging
// ("65.4 kg", "skipped lunch", "bench 60 for 5"). Writes go through the same
// operations as the buttons. None of this reaches tasks, so mentors never see it.

type Json = Record<string, unknown>;
type ToolResult = { text: string; isError?: boolean };
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: Json, ctx: { base: string }) => Promise<ToolResult>;
};

const DATE = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  description: "Day, YYYY-MM-DD. Leave out for today.",
};
const ok = (value: unknown): ToolResult => ({ text: JSON.stringify(value, null, 1) });
const err = (message: string): ToolResult => ({ text: message, isError: true });
const day = (args: Json) =>
  typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : lifeToday();

export const LIFE_TOOLS: Tool[] = [
  {
    name: "get_life_day",
    title: "Meals, gym and body for a day",
    description:
      "The day's routine in time order (weigh-in, meals with recipes and portion sizes, gym session, cooking, defrost reminders) with what is done, the calorie and protein targets, and the gym session's exercises with today's target weights. Read this before logging.",
    inputSchema: { type: "object", properties: { date: DATE }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(args, { base }) {
      const loaded = await loadLife();
      if (loaded.error !== undefined) return err(loaded.error);
      const s = loaded.state;
      const date = day(args);
      const routine = routineFor(s, date).map((i) => ({
        time: clock(Math.max(0, i.time)),
        kind: i.kind,
        title: i.title,
        detail: i.detail,
        done: i.done,
        skipped: i.skipped || undefined,
        slot: i.slot,
        kcal: i.placement ? placedMacros(i.placement)?.kcal : undefined,
        protein_g: i.placement ? placedMacros(i.placement)?.protein : undefined,
      }));
      const gym = routine.find((r) => r.kind === "gym");
      const key =
        s.sessions.find((x) => x.day === date)?.workout ?? nextWorkout(s.sessions.filter((x) => x.day < date));
      const w = workout(key);
      const before = s.sets.filter((x) => x.day < date);
      return ok({
        date,
        targets: s.targets
          ? { kcal: s.kcal, protein_g: s.targets.protein, fat_g: s.targets.fat, carbs_g: s.targets.carbs }
          : "Profile not set up yet",
        weight_trend_kg: s.kg,
        routine,
        gym:
          gym && w
            ? {
                workout: `${w.key}, ${w.name}`,
                exercises: w.blocks.flatMap((b) =>
                  b.items.map((p) => {
                    const ex = resolve(p.exercise, s.profile.gym.missing)!;
                    const t = target({ ...p, exercise: ex.key }, before, isReturning(s, date));
                    return {
                      exercise: ex.key,
                      name: ex.name,
                      sets: t.sets,
                      reps_in_reserve: t.rir,
                      note: p.note,
                      why: t.why,
                      demo_video: demoFor(ex).video,
                    };
                  }),
                ),
              }
            : undefined,
        pages: { today: `${base}/`, meals: `${base}/life`, gym: `${base}/life/gym` },
      });
    },
  },
  {
    name: "log_weight",
    title: "Log a weigh-in",
    description: "Record the morning weigh-in in kg. The trend and the calorie target follow it.",
    inputSchema: {
      type: "object",
      properties: { kg: { type: "number", minimum: 30, maximum: 250 }, date: DATE },
      required: ["kg"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    async run(args) {
      const r = await ops.logWeight(day(args), Math.round(Number(args.kg) * 10) / 10);
      return r.error ? err(r.error) : ok({ logged: Number(args.kg), date: day(args) });
    },
  },
  {
    name: "log_meal",
    title: "Log a meal",
    description:
      "Mark a planned meal as eaten or skipped, or clear it. Eating from a batch takes a portion from the fridge or freezer.",
    inputSchema: {
      type: "object",
      properties: {
        slot: { type: "string", enum: ["breakfast", "lunch", "shake", "dinner"] },
        status: { type: "string", enum: ["eaten", "skipped", "clear"] },
        date: DATE,
      },
      required: ["slot", "status"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    async run(args) {
      const status = args.status === "clear" ? null : (args.status as "eaten" | "skipped");
      const r = await ops.logMeal(day(args), args.slot as Slot, status);
      return r.error ? err(r.error) : ok({ slot: args.slot, status: args.status, date: day(args) });
    },
  },
  {
    name: "log_gym_set",
    title: "Log a gym set",
    description:
      "Record one set of today's session. Use the exercise key from get_life_day; position is the set number starting at 1. Leave kg out for bodyweight work.",
    inputSchema: {
      type: "object",
      properties: {
        exercise: { type: "string", pattern: "^[a-z0-9-]{1,60}$" },
        position: { type: "integer", minimum: 1, maximum: 20 },
        kg: { type: "number", minimum: 0, maximum: 500 },
        reps: { type: "integer", minimum: 0, maximum: 500 },
        reps_in_reserve: { type: "integer", minimum: 0, maximum: 10 },
        date: DATE,
      },
      required: ["exercise", "position", "reps"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    async run(args) {
      const loaded = await loadLife();
      if (loaded.error !== undefined) return err(loaded.error);
      const date = day(args);
      const key =
        loaded.state.sessions.find((x) => x.day === date)?.workout ??
        nextWorkout(loaded.state.sessions.filter((x) => x.day < date));
      const r = await ops.logSet({
        day: date,
        workout: key,
        exercise: String(args.exercise),
        position: Number(args.position),
        kg: typeof args.kg === "number" ? args.kg : null,
        reps: Number(args.reps),
        rir: typeof args.reps_in_reserve === "number" ? args.reps_in_reserve : null,
      });
      return r.error
        ? err(r.error)
        : ok({
            logged: { exercise: args.exercise, set: args.position, kg: args.kg ?? null, reps: args.reps },
            workout: key,
          });
    },
  },
  {
    name: "plan_meal_week",
    title: "Plan this week's meals",
    description:
      "Fill this meal week from the menu in one go: recipes for each cook session sized to the calorie target, plus the shopping list. Only when the week has no cooking done yet.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
    async run(_args, { base }) {
      const r = await ops.planWeek();
      if (r.error) return err(r.error);
      const loaded = await loadLife();
      const cooks =
        loaded.state?.plan?.cooks.map((c) => ({
          day: c.date,
          at: clock(c.start),
          recipe: recipe(c.recipe)?.name,
          portions: c.portions,
        })) ?? [];
      return ok({ planned: "start" in r ? r.start : null, cooks, page: `${base}/life` });
    },
  },
];

export const LIFE_INSTRUCTIONS =
  "Meals, cooking, the gym and weight are the Life space: call get_life_day first, then log with log_weight, log_meal and log_gym_set. Life never goes on tasks. The owner's food rules (allergies with their nuance) live in the portal; only suggest food from its recipes, and say if something might not suit them.";
