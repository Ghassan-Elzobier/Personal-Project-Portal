import "server-only";
import { clock, parseClock } from "../dates/week";
import { err, ok, type Json, type Tool } from "../mcp/tool";
import { resolve, workout } from "./gym/program";
import { plan } from "./gym/duration";
import { demoFor } from "./gym/media";
import { nextWorkout, target } from "./gym/progress";
import { asLeftover, FSA_ADVICE, ruleEatBy } from "./leftovers";
import { lifeToday, loadLife } from "./load";
import type { Slot } from "./nutrition";
import { isOtherSize } from "./other-meal";
import * as ops from "./operations";
import { recipe } from "./recipes";
import { money } from "./shopping";
import { cookBatches, freshTrips, isReturning, routineFor, shopsOn, viewOn, type LifeState } from "./state";

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

const BATCH = {
  type: "string",
  pattern: "^\\d{1,20}$",
  description: "batch of a fridge batch in get_life_day's kitchen.",
};
const SLOT = { type: "string", enum: ["breakfast", "lunch", "shake", "dinner"] };

const COOK_ID = {
  type: "string",
  pattern: "^[a-z0-9-]{1,80}$",
  description: "cook_id of a cook in get_life_day's routine.",
};
const SHOP_ID = {
  type: "string",
  pattern: "^[a-z0-9-]{1,80}$",
  description: "shop_id of a shop in get_life_day's routine.",
};
const PLANNED_ON = { ...DATE, description: "The day it is planned, YYYY-MM-DD. Leave out for today." };
const TO_DATE = { ...DATE, description: "The day to move it to, YYYY-MM-DD, in the same meal week." };
const TO_TIME = {
  type: "string",
  pattern: "^\\d{1,2}:\\d{2}$",
  description: "The time to move it to, 24-hour HH:MM, between 06:00 and 22:00.",
};

/** A planned cook in the meal week of `date`, by id, or why there is none. */
function plannedCookOn(s: LifeState, date: string, id: unknown) {
  const v = viewOn(s, date);
  const c = v.plan?.cooks.find((x) => x.id === id);
  const r = c ? recipe(c.recipe) : undefined;
  if (!c || !r)
    return {
      error: `No such cook in the meal week of ${date}. Take cook_id from get_life_day for the day the cook is planned.`,
    };
  return { v, c, r, cooked: cookBatches(s, v.start, c.id).length > 0 };
}

/** A week's shops still to do, each with its list in a few words, or that it has nothing left to buy. */
function shopsLeft(s: LifeState, date: string) {
  const v = viewOn(s, date);
  return freshTrips(v)
    .filter((t) => !t.doneOn)
    .map((t) => ({
      shop_id: t.id,
      day: t.date,
      at: clock(t.start),
      list: shopsOn(s, v, t.date).find((o) => o.trip.id === t.id)?.list ?? "nothing left to buy",
    }));
}

/** Said when a cook was this week's last and next week had no plan, so it is planning itself. */
const NEXT_WEEK_PLANNING =
  "That was this week's last cook, so next week is planning itself in the same mode, in a moment. See it with get_life_day for a day of next week, or on the Meals page under Next week.";

export const LIFE_TOOLS: Tool[] = [
  {
    name: "get_life_day",
    title: "Meals, gym and body for a day",
    description:
      "The day's routine in time order (weigh-in, meals with recipes and portion sizes, gym session, cooking with each cook's cook_id for log_cook, move_cook and skip_cook, shops with their shop_id for move_shop, defrost reminders) with what is done, the calorie and protein targets, and the gym session: how many minutes it is planned to take in the time the owner has, and its exercises with today's target weights. Extras are marked optional, with fits_today saying whether they fit that time; they are done last and dropped first. logged lists every set logged that day (exercise, position, kg, reps); to correct one, log it again with log_gym_set at the same position and date. Read this before logging.",
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
        // A meal cooked fresh in place of the batch plan; back_to_batch_plan undoes it.
        cooked_fresh: i.kind === "meal" && i.placement?.source === "fresh" ? true : undefined,
        cook_id: i.cookId,
        shop_id: i.kind === "shop" && i.key.startsWith("shop-") ? i.key.slice("shop-".length) : undefined,
        // What was logged for a meal logged, so a plan changed since doesn't change it.
        kcal: i.macros?.kcal,
        protein_g: i.macros?.protein,
      }));
      const gym = routine.find((r) => r.kind === "gym");
      const key =
        s.sessions.find((x) => x.day === date)?.workout ?? nextWorkout(s.sessions.filter((x) => x.day < date));
      const w = workout(key);
      const today = w ? plan(w, s.profile.gym.minutes, s.profile.gym.missing) : undefined;
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
          gym && w && today
            ? {
                workout: `${w.key}, ${w.name}`,
                minutes: today.minutes,
                exercises: w.blocks.flatMap((b, i) =>
                  b.items.map((p) => {
                    const ex = resolve(p.exercise, s.profile.gym.missing)!;
                    const t = target({ ...p, exercise: ex.key }, before, isReturning(s, date), date);
                    return {
                      exercise: ex.key,
                      name: ex.name,
                      sets: t.sets,
                      reps_in_reserve: t.rir,
                      note: p.note,
                      why: t.why,
                      demo_video: demoFor(ex).video,
                      optional: b.optional || undefined,
                      fits_today: b.optional ? today.blocks[i] : undefined,
                    };
                  }),
                ),
                // Every set logged that day, whatever its exercise, so a set can be read back and corrected.
                logged: s.sets
                  .filter((x) => x.day === date)
                  .map((x) => ({
                    exercise: x.exercise,
                    position: x.position,
                    kg: x.kg,
                    reps: x.reps,
                    reps_in_reserve: x.rir,
                  })),
              }
            : undefined,
        // Cooked food to eat from in place of a planned meal (log_meal from_batch).
        kitchen: s.open.flatMap((b) => {
          const r = recipe(b.recipe);
          if (!r || b.remaining < 1) return [];
          // eat_by: the last day it is eaten by from the fridge (FSA, or the owner's
          // own call with set_still_fine); null in the freezer.
          const x = asLeftover(b, r);
          return [
            {
              batch: x.gid,
              recipe: x.name,
              portions_left: x.left,
              where: x.where,
              cooked_on: x.cookedOn,
              eat_by: x.eatBy,
              ...(x.ownCall ? { owner_says_fine: true, fsa_eat_by: ruleEatBy(x.cookedOn, r.keeps) } : {}),
            },
          ];
        }),
        pages: {
          today: `${base}/`,
          meals: `${base}/life`,
          gym: `${base}/life/gym`,
          kitchen: `${base}/life/kitchen?tab=fridge`,
        },
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
      "Mark a meal as eaten as planned, skipped, or something_else, or clear it. eaten takes the planned portion from the fridge or freezer; if the planned cook it comes from wasn't logged, eaten logs that cook first (its portions go in, its ingredients come out) and the reply names it under cooked. Use something_else when the owner ate, but not the planned meal (a friend cooked, a meal out, a sandwich on the go): the planned portion stays where it is and the day still counts the food, as an estimate from the planned meal. Give size for how it compared: lighter, about (the default) or bigger. It also works for a slot marked as eating out. Use skipped only when nothing was eaten. When the owner ate leftovers of another dish from the fridge or freezer instead, use eaten with from_batch, the batch from get_life_day's kitchen: its portion comes out of that batch and the log names its dish, and the planned meal's cook is not logged. Only offer food still in date (eat_by).",
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
        from_batch: {
          type: "string",
          pattern: "^\\d{1,20}$",
          description: "With eaten: the batch in get_life_day's kitchen the meal was eaten from instead of the plan.",
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
      const from = typeof args.from_batch === "string" ? args.from_batch : undefined;
      if (from !== undefined && status !== "eaten") return err("from_batch goes with status eaten.");
      const r = await ops.logMeal(
        day(args),
        args.slot as Slot,
        status,
        isOtherSize(args.size) ? args.size : "about",
        from,
      );
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
        ...(r.planningNext ? { next_week: NEXT_WEEK_PLANNING } : {}),
      });
    },
  },
  {
    name: "log_gym_set",
    title: "Log a gym set",
    description:
      "Record one set of today's session. Use the exercise key from get_life_day; position is the set number starting at 1. Leave kg out for bodyweight work. On an assisted machine (pull-ups, dips), give the help as negative kg: 35 kg of help is -35.",
    inputSchema: {
      type: "object",
      properties: {
        exercise: { type: "string", pattern: "^[a-z0-9-]{1,60}$" },
        position: { type: "integer", minimum: 1, maximum: 20 },
        kg: { type: "number", minimum: -200, maximum: 500 },
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
      const cooked = (state: typeof s) => cookBatches(state, v.start, c.id);
      if (cooked(s).length)
        return err(`${r.name} is already logged as cooked. To undo it, use Undo cook in the Kitchen.`);
      const done = await ops.cookPlanned(v.start, c.id);
      if (done.error !== undefined) return err(done.error);
      const after = await loadLife();
      const batches = after.error === undefined ? cooked(after.state) : [];
      const frozen = batches.filter((b) => b.location === "freezer").reduce((n, b) => n + b.portions, 0);
      return ok({
        cooked: r.name,
        portions: c.portions,
        to_the_fridge: c.portions - frozen,
        to_the_freezer: frozen,
        page: `${base}/life/kitchen?tab=fridge`,
        ...(done.planningNext ? { next_week: NEXT_WEEK_PLANNING } : {}),
      });
    },
  },
  {
    name: "move_cook",
    title: "Move a cook session",
    description:
      "Move a planned cook session to another day or time in its meal week, as the Kitchen's Move does: every dish in it not cooked yet goes, and their portions are sized again for the meals they now feed. Take cook_id (any dish of the session) from get_life_day for the day it is planned, and give that day as date. to_date must be in the same meal week, today or later, and to_time between 06:00 and 22:00. Nothing moves past the week's last day: when the owner has food in already and a cook isn't needed, use skip_cook. Moving it back is another move_cook.",
    inputSchema: {
      type: "object",
      properties: { cook_id: COOK_ID, date: PLANNED_ON, to_date: TO_DATE, to_time: TO_TIME },
      required: ["cook_id", "to_date", "to_time"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(args, { base }) {
      const at = parseClock(String(args.to_time));
      if (at === null) return err("to_time must be HH:MM.");
      const loaded = await loadLife();
      if (loaded.error !== undefined) return err(loaded.error);
      const found = plannedCookOn(loaded.state, day(args), args.cook_id);
      if (found.error !== undefined) return err(found.error);
      const { v, c, r, cooked } = found;
      if (cooked) return err(`${r.name} is already logged as cooked, so it stays where it was cooked.`);
      const from = { date: c.date, at: c.start };
      const moved = await ops.moveCookSession(v.start, from, { date: String(args.to_date), at });
      if (moved.error) return err(moved.error);
      const after = await loadLife();
      const plan = after.error === undefined ? viewOn(after.state, String(args.to_date)).plan : null;
      const dishes = (plan?.cooks ?? [])
        .filter((x) => x.date === args.to_date && x.start === at)
        .map((x) => ({ cook_id: x.id, recipe: recipe(x.recipe)?.name, portions: x.portions }));
      return ok({
        moved: dishes,
        from: { day: from.date, at: clock(from.at) },
        to: { day: args.to_date, at: clock(at) },
        page: `${base}/life/kitchen?tab=fridge`,
      });
    },
  },
  {
    name: "skip_cook",
    title: "Take a cook off the week",
    description:
      "Take a planned cook that isn't cooked yet off its meal week, as the Meals page's remove button does: for when it won't happen, because the owner has enough food in already or won't be home. The meals it fed are filled from what is cooked in the kitchen and still in date, or show nothing planned, and a shop left with nothing to buy drops off Today and the Schedule; the reply says what each of its meals is now, and what each shop still to do buys. There is no undo: to cook it after all, swap a recipe in on the Meals page or plan the week again. Take cook_id from get_life_day for the day the cook is planned, and give that day as date. Say which meals it leaves empty before skipping it.",
    inputSchema: {
      type: "object",
      properties: { cook_id: COOK_ID, date: PLANNED_ON },
      required: ["cook_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async run(args, { base }) {
      const loaded = await loadLife();
      if (loaded.error !== undefined) return err(loaded.error);
      const date = day(args);
      const found = plannedCookOn(loaded.state, date, args.cook_id);
      if (found.error !== undefined) return err(found.error);
      const { v, c, r, cooked } = found;
      if (cooked) return err(`${r.name} is already logged as cooked. To undo it, use Undo cook in the Kitchen.`);
      const fed = v.placements.filter((p) => p.cookId === c.id);
      const removed = await ops.removeCook(v.start, c.id);
      if (removed.error) return err(removed.error);
      const after = await loadLife();
      if (after.error !== undefined) return ok({ skipped: r.name, page: `${base}/life` });
      const now = viewOn(after.state, date).placements;
      return ok({
        skipped: r.name,
        meals_it_fed: fed.map((p) => {
          const x = now.find((n) => n.id === p.id);
          const name = x?.recipe ? recipe(x.recipe)?.name : undefined;
          return {
            day: p.date,
            meal: p.slot,
            now: name
              ? `${name}${x?.storage === "freezer" ? " (from the freezer)" : ""}`
              : x?.source === "out"
                ? "Eating out"
                : "Nothing planned",
          };
        }),
        shops: shopsLeft(after.state, date),
        page: `${base}/life`,
      });
    },
  },
  {
    name: "set_still_fine",
    title: "Say leftovers are still fine",
    description: `When the owner says food in the fridge is still fine past its eat_by, as the Kitchen's Still fine until does: the plan then fills empty lunches and dinners from it up to that day, and leftovers can be logged from it until then. Before calling it, tell the owner once: "${FSA_ADVICE}" Only when they still want it, call it with the batch from get_life_day's kitchen and until, a day after its fsa_eat_by and at most two days past it. clear: true puts the batch back to the Food Standards Agency's eat-by instead. Only the fridge has an eat-by.`,
    inputSchema: {
      type: "object",
      properties: {
        batch: BATCH,
        until: { ...DATE, description: "The last day it is still fine, YYYY-MM-DD." },
        clear: { type: "boolean", description: "true puts it back to the eat-by of the rule." },
      },
      required: ["batch"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(args, { base }) {
      const clear = args.clear === true;
      const until = typeof args.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.until) ? args.until : null;
      if (clear === (until !== null)) return err("Give until, or clear: true, not both.");
      const r = await ops.setBatchFineUntil(String(args.batch), clear ? null : until);
      if (r.error !== undefined) return err(r.error);
      const after = await loadLife();
      const b = after.error === undefined ? after.state.open.find((x) => x.gid === args.batch) : undefined;
      const rec = b ? recipe(b.recipe) : undefined;
      const x = b && rec ? asLeftover(b, rec) : undefined;
      return ok({
        batch: args.batch,
        recipe: rec?.name,
        eat_by: x?.eatBy,
        owner_says_fine: x?.ownCall ?? !clear,
        page: `${base}/life/kitchen?tab=fridge`,
      });
    },
  },
  {
    name: "back_to_batch_plan",
    title: "Put a fresh meal back on the batch plan",
    description:
      "Take a meal cooked fresh (cooked_fresh in get_life_day's routine) back to the batch plan, as the Meals page's Back to the batch plan does: for when the owner won't cook it, or a shop move put it on a day it doesn't suit. The meal then comes from the week's batch cooks or the food in the kitchen, or shows nothing planned; the reply says what it is now. Give the day and the meal.",
    inputSchema: {
      type: "object",
      properties: { slot: SLOT, date: DATE },
      required: ["slot"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(args, { base }) {
      const loaded = await loadLife();
      if (loaded.error !== undefined) return err(loaded.error);
      const date = day(args);
      const slot = args.slot as Slot;
      const v = viewOn(loaded.state, date);
      const p = v.placements.find((x) => x.date === date && x.slot === slot);
      if (!v.plan || p?.source !== "fresh")
        return err(`The ${slot} on ${date} isn't cooked fresh. Take a meal with cooked_fresh from get_life_day.`);
      const fresh = recipe(p.recipe ?? "")?.name;
      const r = await ops.setFresh(v.start, date, slot, null);
      if (r.error !== undefined) return err(r.error);
      const after = await loadLife();
      const now =
        after.error === undefined ? viewOn(after.state, date).placements.find((x) => x.id === p.id) : undefined;
      const name = now?.recipe ? recipe(now.recipe)?.name : undefined;
      return ok({
        day: date,
        meal: slot,
        was: fresh,
        now: name ? `${name}${now?.storage === "freezer" ? " (from the freezer)" : ""}` : "Nothing planned",
        page: `${base}/life`,
      });
    },
  },
  {
    name: "move_shop",
    title: "Move a shop",
    description:
      "Move one of a fresh week's shops to another day or time in its meal week, as the Kitchen's Move does, and the week with it: a cook that needs its food and would start before it is home moves to after it, a meal cooked fresh from it moves to the same meal on a later day with room, and a shop it reaches is joined. Take shop_id from get_life_day for the day the shop is planned, and give that day as date. to_date must be in the same meal week and the time still to come, between 06:00 and 22:00. The reply says what moved with it. undo: true puts the week back as it was before its last shop move instead, given any day of that week as date. A shop with nothing to buy isn't on get_life_day: to drop one, skip the cooks it buys for.",
    inputSchema: {
      type: "object",
      properties: {
        shop_id: SHOP_ID,
        date: PLANNED_ON,
        to_date: TO_DATE,
        to_time: TO_TIME,
        undo: { type: "boolean", description: "True to put the week back as it was before its last shop move." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async run(args, { base }) {
      const loaded = await loadLife();
      if (loaded.error !== undefined) return err(loaded.error);
      const s = loaded.state;
      const date = day(args);
      const v = viewOn(s, date);
      const page = `${base}/life/kitchen${v.start === s.weekStart ? "" : "?week=next"}`;
      if (args.undo === true) {
        const back = await ops.undoShopMove(v.start);
        return back.error
          ? err(back.error)
          : ok({ undone: true, shops: shopsLeft((await loadLife()).state ?? s, date), page });
      }
      if (typeof args.shop_id !== "string" || typeof args.to_date !== "string" || typeof args.to_time !== "string")
        return err(
          "Give shop_id, to_date and to_time to move a shop (and date, the day it is planned), or undo: true.",
        );
      const at = parseClock(args.to_time);
      if (at === null) return err("to_time must be HH:MM.");
      if (!freshTrips(v).some((t) => t.id === args.shop_id))
        return err(
          `No such shop in the meal week of ${date}. Take shop_id from get_life_day for the day the shop is planned.`,
        );
      const moved = await ops.moveShop(v.start, args.shop_id, { date: args.to_date, at });
      if (moved.error !== undefined) return err(moved.error);
      return ok({ moved: moved.said, page });
    },
  },
  {
    name: "plan_meal_week",
    title: "Plan this week's meals",
    description:
      "Fill this meal week from the menu in one go: recipes for each cook session sized to the calorie target, plus the shopping list. The mains are chosen together so they share packs and little is wasted, and they take turns with what the weeks before had the owner eat (as planned, or as logged), so a dish had lately waits its turn unless repeating it saves enough to be worth it; each says why it was picked, and the week says what it costs. Only when the week has no cooking done yet. mode 'batch' is two long cooks of two dishes and one shop; 'fresh' is short cooks of one dish every couple of days and two or three small shops, with nothing frozen. Left out, a re-plan keeps the week's mode. cheaper: true picks the cheapest good week instead of the best value. With two days or fewer left in the week, it plans just those days instead, whatever the mode (rest_of_week in the reply): a dinner cooked fresh each night, lunches from cooked food in the kitchen, the daily breakfast and shakes, and one small shop before dinner, with no batch cook. If the owner would rather skip to next week, don't call it; next week is planned from the Meals page.",
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
      const fresh = plan?.fresh.map((f) => ({ day: f.date, meal: f.slot, recipe: recipe(f.recipe)?.name })) ?? [];
      const cost = plan?.cost;
      return ok({
        planned: "start" in r ? r.start : null,
        mode: plan?.mode ?? "batch",
        ...(plan?.short ? { rest_of_week: true } : {}),
        cooks,
        ...(fresh.length ? { cooked_fresh: fresh } : {}),
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
  "Meals, cooking, the gym and weight are the Life space: call get_life_day first, then log with log_weight, log_meal and log_gym_set. When the owner says they are done at the gym, call finish_gym_session after the last set, or tomorrow offers the same workout again. When they say they cooked a planned meal, call log_cook with its cook_id from get_life_day, so the fridge and the cupboard stay right. When a cook or a shop won't happen when planned, move it within its meal week with move_cook or move_shop; when the owner has food in already and a cook isn't needed, skip_cook takes it off, and a shop left with nothing to buy drops off. A meal cooked fresh goes back to the batch plan with back_to_batch_plan. When the owner says food in the fridge is still fine past its eat_by, say the Food Standards Agency's advice once, then set_still_fine records it. Life never goes on tasks: personal to-dos and deadlines are the Life to-dos (add_life_todo, list_life_todos). The owner's food rules (allergies with their nuance) live in the portal; only suggest food from its recipes, and say if something might not suit them.";
