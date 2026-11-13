import "server-only";
import { rpcAsCaller } from "../supabase/caller";
import type { Tag } from "./allergens";
import type { Unit } from "./ingredients";
import type { Slot } from "./nutrition";
import type { WeekPlan } from "./planner";
import type { Product, StockRow } from "./shopping";
import type { Batch, LifeRaw, MealLog } from "./state";

// The Life tables, through their RPCs (supabase/migrations/20261112120000_life.sql).
// Browser calls use the session; connector calls prove themselves with their token.

export class LifeError extends Error {}

const READABLE = new Set(["42501", "P0002", "22023"]);

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await rpcAsCaller(name, args);
  if (error) {
    if (error.code === "PGRST202")
      throw new LifeError("The Life tables are not in the database yet. Run the latest migration.");
    if (!READABLE.has(error.code)) console.error(name, error.code, error.message);
    throw new LifeError(
      READABLE.has(error.code)
        ? error.message
        : ["23514", "22P02", "22007", "22008"].includes(error.code)
          ? "Those values are not valid."
          : "The database did not answer. Try again in a minute.",
    );
  }
  return data as T;
}

type Row = Record<string, unknown>;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function readLife(since: string): Promise<LifeRaw> {
  const raw = await rpc<Record<string, Row[] | Row | null>>("life_read", { p_since: since });
  const list = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as Row[]) : []);
  return {
    profile: raw.profile,
    weights: list("weights").map((w) => ({ day: String(w.day), kg: Number(w.kg) })),
    plans: list("plans").map((p) => ({ start: String(p.start), data: p.data as WeekPlan })),
    meals: list("meals").map((m) => ({
      day: String(m.day),
      slot: m.slot as Slot,
      status: m.status as MealLog["status"],
      recipe: (m.recipe as string) ?? null,
      batchGid: (m.batch_gid as string) ?? null,
      kcal: n(m.kcal),
      protein: n(m.protein),
      note: (m.note as string) ?? null,
    })),
    batches: list("batches").map((b) => ({
      gid: String(b.gid),
      recipe: String(b.recipe),
      cookedOn: String(b.cooked_on),
      portions: Number(b.portions),
      remaining: Number(b.remaining),
      scale: Number(b.scale),
      location: b.location as Batch["location"],
      planStart: (b.plan_start as string) ?? null,
      cookId: (b.cook_id as string) ?? null,
    })),
    ratings: list("ratings").map((r) => ({
      recipe: String(r.recipe),
      stars: Number(r.stars),
      note: (r.note as string) ?? null,
    })),
    lastHad: (raw.last_had as Record<string, string>) ?? {},
    stock: list("stock").map((s) => ({
      item: String(s.item),
      qty: Number(s.qty),
      status: (s.status as StockRow["status"]) ?? null,
      goodUntil: (s.good_until as string) ?? null,
    })),
    products: list("products").map((p) => ({
      item: String(p.item),
      url: String(p.url),
      name: String(p.name),
      packQty: Number(p.pack_qty),
      packUnit: p.pack_unit as Unit,
      pence: n(p.pence),
      checked: (p.checked as Tag[]) ?? [],
    })),
    sessions: list("sessions").map((s) => ({
      day: String(s.day),
      workout: String(s.workout),
      finished: Boolean(s.finished),
      feel: n(s.feel),
      notes: String(s.notes ?? ""),
    })),
    sets: list("sets").map((s) => ({
      day: String(s.day),
      workout: String(s.workout),
      exercise: String(s.exercise),
      position: Number(s.position),
      kg: n(s.kg),
      reps: n(s.reps),
      rir: n(s.rir),
    })),
  };
}

export const saveProfile = (data: unknown) => rpc<void>("life_save_profile", { p_data: data });
export const logWeight = (day: string, kg: number | null) => rpc<void>("life_log_weight", { p_day: day, p_kg: kg });
export const savePlan = (start: string, data: WeekPlan | null) =>
  rpc<void>("life_save_plan", { p_start: start, p_data: data });
export const rate = (recipe: string, stars: number | null, note?: string) =>
  rpc<void>("life_rate", { p_recipe: recipe, p_stars: stars, p_note: note ?? null });

export const logMeal = (m: {
  day: string;
  slot: Slot;
  status: MealLog["status"] | null;
  recipe?: string | null;
  batch?: string | null;
  kcal?: number | null;
  protein?: number | null;
  note?: string | null;
}) =>
  rpc<void>("life_log_meal", {
    p_day: m.day,
    p_slot: m.slot,
    p_status: m.status,
    p_recipe: m.recipe ?? null,
    p_batch: m.batch ?? null,
    p_kcal: m.kcal ?? null,
    p_protein: m.protein ?? null,
    p_note: m.note ?? null,
  });

export const cook = (c: {
  recipe: string;
  day: string;
  portions: number;
  scale: number;
  freeze: number;
  used: { item: string; qty: number }[];
  planStart?: string | null;
  cookId?: string | null;
}) =>
  rpc<string>("life_cook", {
    p_recipe: c.recipe,
    p_day: c.day,
    p_portions: c.portions,
    p_scale: c.scale,
    p_freeze: c.freeze,
    p_used: c.used,
    p_plan_start: c.planStart ?? null,
    p_cook_id: c.cookId ?? null,
  });

export const uncook = (batch: string) => rpc<void>("life_uncook", { p_batch: batch });
export const setBatch = (batch: string, remaining: number | null, location: "fridge" | "freezer" | null) =>
  rpc<void>("life_set_batch", { p_batch: batch, p_remaining: remaining, p_location: location });
export const changeStock = (
  changes: { item: string; qty?: number; status?: StockRow["status"]; good_until?: string | null }[],
  mode: "add" | "set",
) => rpc<void>("life_stock", { p_changes: changes, p_mode: mode });

export const saveProduct = (p: Product) =>
  rpc<void>("life_save_product", {
    p_item: p.item,
    p_url: p.url,
    p_name: p.name,
    p_pack_qty: p.packQty,
    p_pack_unit: p.packUnit,
    p_pence: p.pence,
    p_checked: p.checked,
  });
export const removeProduct = (item: string) => rpc<void>("life_save_product", { p_item: item, p_url: null });

export const logSet = (s: {
  day: string;
  workout: string;
  exercise: string;
  position: number;
  kg: number | null;
  reps: number | null;
  rir: number | null;
}) =>
  rpc<void>("gym_log_set", {
    p_day: s.day,
    p_workout: s.workout,
    p_exercise: s.exercise,
    p_position: s.position,
    p_kg: s.kg,
    p_reps: s.reps,
    p_rir: s.rir,
  });

export const gymSession = (s: {
  day: string;
  workout: string;
  finished?: boolean;
  feel?: number | null;
  notes?: string | null;
  remove?: boolean;
}) =>
  rpc<void>("gym_session", {
    p_day: s.day,
    p_workout: s.workout,
    p_finished: s.finished ?? false,
    p_feel: s.feel ?? null,
    p_notes: s.notes ?? null,
    p_delete: s.remove ?? false,
  });
