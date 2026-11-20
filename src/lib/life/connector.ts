import "server-only";
import { clock } from "../dates/week";
import { err, ok, type Json, type Tool } from "../mcp/tool";
import { resolve, workout } from "./gym/program";
import { demoFor } from "./gym/media";
import { nextWorkout, target } from "./gym/progress";
import { lifeToday, loadLife } from "./load";
import type { Slot } from "./nutrition";
import { isOtherSize } from "./other-meal";
import * as ops from "./operations";
import { recipe } from "./recipes";
import { money } from "./shopping";
import { isReturning, placedMacros, routineFor, viewOn } from "./state";

// Life tools for the Claude connector: what today holds, and one-line logging
// ("65.4 kg", "skipped lunch", "bench 60 for 5"). Writes go through the same
// operations as the buttons. None of this reaches tasks, so mentors never see it.

const DATE = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  description: "Day, YYYY-MM-DD. Leave out for today.",
};
const day = (args: Json) =>
  typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : lifeToday();

export const LIFE_TOOLS: Tool[] = [
  {
    name: "get_life_day",
    title: "Meals, gym and body for a day",
    description:
      "The day's routine in time order (weigh-in, meals with recipes and portion sizes, gym session, cooking with each cook's cook_id for log_cook, defrost reminders) with what is done, the calorie and protein targets, and the gym session's exercises with today's target weights. Read this before logging.",
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
        cook_id: i.cookId,
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
          : s.setUp
            ? `No weigh-in yet, so no targets: log one to work them out. Portions are sized to ${s.kcal} kcal until then.`
            : "Profile not set up yet: add sex, birth year and height in Life settings.",
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
      "Mark a meal as eaten as planned, skipped, or something_else, or clear it. eaten takes the planned portion from the fridge or freezer; if the planned cook it comes from wasn't logged, eaten logs that cook first (its portions go in, its ingredients come out) and the reply names it under cooked. Use something_else when the owner ate, but not the planned meal (a friend cooked, a meal out, a sandwich on the go): the planned portion stays where it is and the day still counts the food, as an estimate from the planned meal. Give size for how it compared: lighter, about (the default) or bigger. It also works for a slot marked as eating out. Use skipped only when nothing was eaten.",
    inputSchema: {
      type: "object",
      properties: {
        slot: { type: "string", enum: ["breakfast", "lunch", "shake", "dinner"] },
        status: { type: "string", enum: ["eaten", "skipped", "something_else", "clear"] },
        size: {
          type: "string",
          enum: ["lighter", "about", "bigger"],
          description: "With something_else: how the meal compared with the planned one.",
        },
        date: DATE,
      },
      required: ["slot", "status"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    async run(args) {
      const status =
        args.status === "clear"
          ? null
          : args.status === "something_else"
            ? "swapped"
            : (args.status as "eaten" | "skipped");
      const r = await ops.logMeal(day(args), args.slot as Slot, status, isOtherSize(args.size) ? args.size : "about");
      if (r.error !== undefined) return err(r.error);
      return ok({
        slot: args.slot,
        status: args.status,
        date: day(args),
        ...(r.estimate
          ? {
              logged_as: { kcal: r.estimate.kcal, protein_g: r.estimate.protein },
              note: "An estimate from the planned meal. The planned portion was not taken from the kitchen.",
            }
          : {}),
        ...(r.cooked?.length
          ? {
              cooked: r.cooked.map((c) => ({
                cook_id: c.cookId,
                recipe: c.name,
                fridge: c.fridge,
                freezer: c.freezer,
              })),
            }
          : {}),
      });
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
    name: "finish_gym_session",
    title: "Finish the gym session",
    description:
      "Mark a day's gym session finished, as the Finish session button does: the programme moves on to the next workout and Today shows the gym as done. Call it after the last set is logged, when the owner says they are done. Optionally how it felt (1 to 5) and a note. A day with nothing logged can't be finished. reopen: true undoes it.",
    inputSchema: {
      type: "object",
      properties: {
        date: DATE,
        feel: { type: "integer", minimum: 1, maximum: 5, description: "How it felt, 1 (rough) to 5 (great)." },
        notes: { type: "string", maxLength: 1000, description: "Anything to remember: a twinge, a PR." },
        reopen: { type: "boolean", description: "True to reopen a finished session instead." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(args, { base }) {
      const loaded = await loadLife();
      if (loaded.error !== undefined) return err(loaded.error);
      const s = loaded.state;
      const date = day(args);
      const session = s.sessions.find((x) => x.day === date);
      const key = session?.workout ?? nextWorkout(s.sessions.filter((x) => x.day < date));
      const named = (k: string) => {
        const w = workout(k);
        return w ? `${w.key}, ${w.name}` : k;
      };
      const page = `${base}/life/gym`;
      if (args.reopen === true) {
        if (!session?.finished) return err(`No finished session on ${date} to reopen.`);
        const r = await ops.gymSession({ day: date, workout: key, finished: false });
        return r.error ? err(r.error) : ok({ reopened: named(key), date, page });
      }
      const sets = s.sets.filter((x) => x.day === date).length;
      if (!session && sets === 0)
        return err(`Nothing is logged on ${date} yet. Log the sets with log_gym_set first, then finish the session.`);
      const r = await ops.gymSession({
        day: date,
        workout: key,
        finished: true,
        feel: typeof args.feel === "number" ? args.feel : null,
        notes: typeof args.notes === "string" ? args.notes : null,
      });
      if (r.error) return err(r.error);
      // The rotation as it stands with this session finished.
      const others = s.sessions.filter((x) => x.day !== date && x.day < date);
      const next = nextWorkout([...others, { day: date, workout: key, finished: true, feel: null, notes: "" }]);
      return ok({ finished: named(key), date, sets_logged: sets, next_workout: named(next), page });
    },
  },
  {
    name: "log_cook",
    title: "Log a planned cook",
    description:
      "Mark a planned cook as cooked, as the Cook button does: its portions go into the fridge (the ones for later in the week into the freezer) and the ingredients come out of the cupboard, so meals eaten from it are counted. Take cook_id from get_life_day for the day the cook is planned, and give that day as date. A cook already logged is refused: it can be undone in the Kitchen.",
    inputSchema: {
      type: "object",
      properties: {
        cook_id: {
          type: "string",
          pattern: "^[a-z0-9-]{1,80}$",
          description: "cook_id of a cook in get_life_day's routine.",
        },
        date: { ...DATE, description: "The day the cook is planned, YYYY-MM-DD. Leave out for today." },
      },
      required: ["cook_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(args, { base }) {
      const loaded = await loadLife();
      if (loaded.error !== undefined) return err(loaded.error);
      const s = loaded.state;
      const date = day(args);
      const v = viewOn(s, date);
      const c = v.plan?.cooks.find((x) => x.id === args.cook_id);
      const r = c ? recipe(c.recipe) : undefined;
      if (!c || !r)
        return err(
          `No such cook in the meal week of ${date}. Take cook_id from get_life_day for the day the cook is planned.`,
        );
      const cooked = (state: typeof s) => state.batches.filter((b) => b.planStart === v.start && b.cookId === c.id);
      if (cooked(s).length)
        return err(`${r.name} is already logged as cooked. To undo it, use Undo cook in the Kitchen.`);
      const done = await ops.cookPlanned(v.start, c.id);
      if (done.error) return err(done.error);
      const after = await loadLife();
      const batches = after.error === undefined ? cooked(after.state) : [];
      const frozen = batches.filter((b) => b.location === "freezer").reduce((n, b) => n + b.portions, 0);
      return ok({
        cooked: r.name,
        portions: c.portions,
        to_the_fridge: c.portions - frozen,
        to_the_freezer: frozen,
        page: `${base}/life/kitchen?tab=fridge`,
      });
    },
  },
  {
    name: "plan_meal_week",
    title: "Plan this week's meals",
    description:
      "Fill this meal week from the menu in one go: recipes for each cook session sized to the calorie target, plus the shopping list. The mains are chosen together so they share packs and little is wasted; each says why it was picked, and the week says what it costs. Only when the week has no cooking done yet. mode 'batch' is two long cooks of two dishes and one shop; 'fresh' is short cooks of one dish every couple of days and two or three small shops, with nothing frozen. Left out, a re-plan keeps the week's mode. cheaper: true picks the cheapest good week instead of the best value.",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["batch", "fresh"] }, cheaper: { type: "boolean" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    async run(args, { base }) {
      const mode = args.mode === "batch" || args.mode === "fresh" ? args.mode : undefined;
      const r = await ops.planWeek(undefined, mode, args.cheaper === true);
      if (r.error) return err(r.error);
      const loaded = await loadLife();
      const plan = loaded.state?.plan;
      const cooks =
        plan?.cooks.map((c) => ({
          day: c.date,
          at: clock(c.start),
          recipe: recipe(c.recipe)?.name,
          portions: c.portions,
          ...(c.why?.length ? { why: c.why } : {}),
        })) ?? [];
      const shops = plan?.trips?.map((t) => ({ day: t.date, at: clock(t.start) }));
      const cost = plan?.cost;
      return ok({
        planned: "start" in r ? r.start : null,
        mode: plan?.mode ?? "batch",
        cooks,
        ...(shops ? { shops } : {}),
        ...(cost
          ? {
              cost: {
                basket: money(cost.pence),
                wasted: money(cost.waste),
                items: cost.items,
                ...(cost.cheaper && cost.pence + cost.waste - cost.cheaper >= 50
                  ? { cheaperWeekSaves: money(cost.pence + cost.waste - cost.cheaper) }
                  : {}),
              },
            }
          : {}),
        page: `${base}/life`,
      });
    },
  },
];

export const LIFE_INSTRUCTIONS =
  "Meals, cooking, the gym and weight are the Life space: call get_life_day first, then log with log_weight, log_meal and log_gym_set. When the owner says they are done at the gym, call finish_gym_session after the last set, or tomorrow offers the same workout again. When they say they cooked a planned meal, call log_cook with its cook_id from get_life_day, so the fridge and the cupboard stay right. Life never goes on tasks. The owner's food rules (allergies with their nuance) live in the portal; only suggest food from its recipes, and say if something might not suit them.";
