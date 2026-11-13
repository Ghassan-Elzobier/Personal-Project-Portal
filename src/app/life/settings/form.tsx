"use client";

import { useState, type ReactNode } from "react";
import { FORMS, FORM_LABELS, GROUPS, TAG_LABELS, type Form, type Rule, type Tag } from "@/lib/life/allergens";
import type { LifeProfile } from "@/lib/life/profile";
import type { Cuisine, Kit } from "@/lib/life/recipes";
import { saveProfile } from "../actions";
import { useAction } from "../kit";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CUISINES: Cuisine[] = [
  "Italian",
  "Middle Eastern",
  "Chinese & SE Asian",
  "Indian",
  "Caribbean & West African",
  "British & American",
];
const KIT: Kit[] = ["oven", "hob", "air fryer", "blender"];
const MISSING = [
  ["trap-bar", "Trap bar"],
  ["med-ball", "Medicine ball"],
  ["box", "Plyo box"],
  ["landmine", "Landmine"],
  ["sled", "Sled"],
  ["leg-press", "Leg press"],
  ["ham-curl", "Hamstring curl machine"],
  ["back-extension", "Back extension bench"],
  ["leg-extension", "Leg extension machine"],
  ["dip-station", "Dip station or captain's chair"],
  ["ab-wheel", "Ab wheel"],
  ["pull-up-bar", "Pull-up bar"],
  ["cable", "Cable machine"],
] as const;
const FRUITS: Tag[] = ["apple", "banana", "pear", "stone-fruit", "kiwi", "mango"];
const OTHERS: Tag[] = [
  "milk",
  "gluten",
  "sesame",
  "fish",
  "crustacean",
  "mollusc",
  "mustard",
  "celery",
  "sulphite",
  "coconut",
  "lupin",
  "legume-gum",
];

const time = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const mins = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};

export function SettingsForm({
  profile,
  recipes,
  allRecipes,
}: {
  profile: LifeProfile;
  recipes: { key: string; name: string }[];
  allRecipes: { key: string; name: string }[];
}) {
  const [p, setP] = useState<LifeProfile>(profile);
  const { pending, run } = useAction();
  const set = (fn: (d: LifeProfile) => void) =>
    setP((cur) => {
      const next = structuredClone(cur);
      fn(next);
      return next;
    });
  const rule = (tag: Tag) => p.food.rules.find((r) => r.tag === tag);
  const setRule = (tag: Tag, change: Partial<Rule> | null) =>
    set((d) => {
      const rest = d.food.rules.filter((r) => r.tag !== tag);
      if (change === null) d.food.rules = rest;
      else
        d.food.rules = [
          ...rest,
          { ...(d.food.rules.find((r) => r.tag === tag) ?? { tag, level: "avoid" }), ...change, tag },
        ];
    });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveProfile(p), "Saved. Plans and portions follow it from now on.");
      }}
    >
      <Section title="You" hint="For the calorie estimate. Age comes from the year.">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Sex for the maths">
            <select
              className="field-input"
              value={p.body.sex ?? ""}
              onChange={(e) => set((d) => void (d.body.sex = (e.target.value || null) as LifeProfile["body"]["sex"]))}
            >
              <option value="">Choose</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </Field>
          <Field label="Born in">
            <input
              className="field-input"
              inputMode="numeric"
              value={p.body.birthYear ?? ""}
              onChange={(e) => set((d) => void (d.body.birthYear = Number(e.target.value) || null))}
              placeholder="1995"
            />
          </Field>
          <Field label="Height cm">
            <input
              className="field-input"
              inputMode="numeric"
              value={p.body.heightCm ?? ""}
              onChange={(e) => set((d) => void (d.body.heightCm = Number(e.target.value) || null))}
              placeholder="175"
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Goal"
        hint="0.25 to 0.5% of body weight a week builds muscle with little fat. Newer lifters and those coming back can sit at the top."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Gain a week">
            <select
              className="field-input"
              value={p.goal.ratePct}
              onChange={(e) => set((d) => void (d.goal.ratePct = Number(e.target.value)))}
            >
              {[0, 0.25, 0.3, 0.4, 0.5, 0.75].map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? "Maintain" : `${v}% of body weight`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Protein">
            <select
              className="field-input"
              value={p.goal.proteinPerKg}
              onChange={(e) => set((d) => void (d.goal.proteinPerKg = Number(e.target.value)))}
            >
              {[1.6, 1.8, 2.0, 2.2].map((v) => (
                <option key={v} value={v}>
                  {v} g per kg
                </option>
              ))}
            </select>
          </Field>
          <Field label="Activity">
            <select
              className="field-input"
              value={p.activity}
              onChange={(e) => set((d) => void (d.activity = Number(e.target.value)))}
            >
              <option value={1.4}>Desk job, little else (1.4)</option>
              <option value={1.55}>Desk job and 3 sessions (1.55)</option>
              <option value={1.7}>On your feet, or very active (1.7)</option>
            </select>
          </Field>
        </div>
        <Field label="Fixed daily kcal (leave empty to let it learn)">
          <input
            className="field-input"
            inputMode="numeric"
            value={p.goal.kcalOverride ?? ""}
            onChange={(e) => set((d) => void (d.goal.kcalOverride = Number(e.target.value) || null))}
            placeholder="Learns from your weight"
          />
        </Field>
      </Section>

      <Section
        title="Food rules"
        hint="Allergies with their nuance. A food you avoid is never in a suggested recipe; forms you allow are fine."
      >
        <RuleRow
          label="Egg"
          rule={rule("egg")}
          onLevel={(level) => setRule("egg", level === null ? null : { level })}
          forms={
            rule("egg") && (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {FORMS.map((f) => (
                  <Check
                    key={f}
                    checked={rule("egg")?.allowForms?.includes(f) ?? false}
                    onChange={() => setRule("egg", { allowForms: toggle(rule("egg")?.allowForms ?? [], f) })}
                  >
                    Fine {FORM_LABELS[f]}
                  </Check>
                ))}
              </div>
            )
          }
        />
        {Object.entries(GROUPS).map(([key, g]) => {
          const levels = g.tags.map((t) => rule(t)?.level ?? null);
          const level = levels.every((l) => l === levels[0]) ? levels[0] : "mixed";
          return (
            <RuleRow
              key={key}
              label={g.label}
              detail={g.tags.map((t) => TAG_LABELS[t].split(" (")[0]).join(", ")}
              rule={level === null ? undefined : { tag: g.tags[0], level: level === "mixed" ? "avoid" : level }}
              mixed={level === "mixed"}
              onLevel={(l) =>
                set(
                  (d) =>
                    void (d.food.rules = [
                      ...d.food.rules.filter((r) => !g.tags.includes(r.tag)),
                      ...(l === null ? [] : g.tags.map((tag) => ({ tag, level: l }))),
                    ]),
                )
              }
            />
          );
        })}
        {FRUITS.map((t) => (
          <RuleRow
            key={t}
            label={cap(TAG_LABELS[t].split(" (")[0])}
            rule={rule(t)}
            onLevel={(level) => setRule(t, level === null ? null : { level })}
            forms={
              rule(t) && (
                <div className="flex flex-wrap gap-x-4">
                  {(["cooked", "processed"] as Form[]).map((f) => (
                    <Check
                      key={f}
                      checked={rule(t)?.allowForms?.includes(f) ?? false}
                      onChange={() => setRule(t, { allowForms: toggle(rule(t)?.allowForms ?? [], f) })}
                    >
                      Fine {f === "cooked" ? "cooked (crumble, sauce)" : "as juice or vinegar"}
                    </Check>
                  ))}
                </div>
              )
            }
          />
        ))}
        <details className="rounded-xl bg-white/5 p-3">
          <summary className="cursor-pointer text-sm text-neutral-300">Other allergens</summary>
          <div className="mt-2 space-y-2">
            {OTHERS.map((t) => (
              <RuleRow
                key={t}
                label={cap(TAG_LABELS[t].split(" (")[0])}
                rule={rule(t)}
                onLevel={(level) => setRule(t, level === null ? null : { level })}
              />
            ))}
          </div>
        </details>
        <Check
          checked={p.food.avoidTraits.includes("strong")}
          onChange={() => set((d) => void (d.food.avoidTraits = toggle(d.food.avoidTraits, "strong")))}
        >
          Steer clear of strong flavours (olives, capers, anchovies, blue cheese)
        </Check>
      </Section>

      <Section title="Taste">
        <p className="field-label">Cuisines you&apos;d eat every week</p>
        <div className="flex flex-wrap gap-2">
          {CUISINES.map((c) => (
            <Pill
              key={c}
              on={p.cuisines.includes(c)}
              onClick={() => set((d) => void (d.cuisines = toggle(d.cuisines, c)))}
            >
              {c}
            </Pill>
          ))}
        </div>
        <p className="field-label">Favourites (they come round more often)</p>
        <div className="flex flex-wrap gap-2">
          {recipes.map((r) => (
            <Pill
              key={r.key}
              on={p.favourites.includes(r.key)}
              onClick={() => set((d) => void (d.favourites = toggle(d.favourites, r.key)))}
            >
              {r.name}
            </Pill>
          ))}
        </div>
        {p.hidden.length > 0 && (
          <>
            <p className="field-label">Hidden from your menu (tap to bring back)</p>
            <div className="flex flex-wrap gap-2">
              {p.hidden.map((k) => (
                <Pill key={k} on={false} onClick={() => set((d) => void (d.hidden = d.hidden.filter((x) => x !== k)))}>
                  {allRecipes.find((r) => r.key === k)?.name ?? k} ✕
                </Pill>
              ))}
            </div>
          </>
        )}
        <Field label="Hottest you'd like">
          <select
            className="field-input"
            value={p.spiceMax}
            onChange={(e) => set((d) => void (d.spiceMax = Number(e.target.value)))}
          >
            <option value={0}>No heat</option>
            <option value={1}>Warm</option>
            <option value={2}>Medium</option>
            <option value={3}>Hot</option>
          </select>
        </Field>
      </Section>

      <Section title="Kitchen and routine">
        <p className="field-label">Kit</p>
        <div className="flex flex-wrap gap-2">
          {KIT.map((k) => (
            <Pill key={k} on={p.kit.includes(k)} onClick={() => set((d) => void (d.kit = toggle(d.kit, k)))}>
              {k}
            </Pill>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["breakfast", "lunch", "shake", "dinner"] as const).map((slot) => (
            <Field key={slot} label={cap(slot)}>
              <input
                type="time"
                className="field-input"
                value={time(p.routine[slot])}
                onChange={(e) => set((d) => void (d.routine[slot] = mins(e.target.value)))}
              />
            </Field>
          ))}
        </div>
        <p className="field-label">Cook sessions (the first starts the meal week)</p>
        <ul className="space-y-2">
          {p.routine.cooks.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <select
                className="field-input mt-0 w-auto"
                value={c.weekday}
                onChange={(e) => set((d) => void (d.routine.cooks[i].weekday = Number(e.target.value)))}
                aria-label="Day"
              >
                {DAYS.map((day, j) => (
                  <option key={day} value={j}>
                    {day}
                  </option>
                ))}
              </select>
              <input
                type="time"
                className="field-input mt-0 w-auto"
                value={time(c.start)}
                onChange={(e) => set((d) => void (d.routine.cooks[i].start = mins(e.target.value)))}
                aria-label="Start"
              />
              {p.routine.cooks.length > 1 && (
                <button
                  type="button"
                  className="text-sm text-neutral-400 hover:text-coral"
                  onClick={() => set((d) => void d.routine.cooks.splice(i, 1))}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {p.routine.cooks.length < 3 && (
          <button
            type="button"
            className="text-sm text-mint"
            onClick={() => set((d) => void d.routine.cooks.push({ weekday: 4, start: 18 * 60 }))}
          >
            + Add a cook session
          </button>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Weekend dinners cooked fresh">
            <select
              className="field-input"
              value={p.routine.weekendFresh}
              onChange={(e) => set((d) => void (d.routine.weekendFresh = Number(e.target.value)))}
            >
              <option value={0}>None: batches all week</option>
              <option value={1}>One (Saturday, or Sunday if Saturday is a cook day)</option>
              <option value={2}>Both</option>
            </select>
          </Field>
          <Field label="Same lunch or dinner at most">
            <select
              className="field-input"
              value={p.routine.maxRepeat}
              onChange={(e) => set((d) => void (d.routine.maxRepeat = Number(e.target.value)))}
            >
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} days running
                </option>
              ))}
            </select>
          </Field>
          <Check
            checked={p.routine.lunchAtWork}
            onChange={() => set((d) => void (d.routine.lunchAtWork = !d.routine.lunchAtWork))}
          >
            Lunch is reheated at work, so keep weekend dishes for dinner
          </Check>
        </div>
      </Section>

      <Section title="Gym" id="gym">
        <p className="field-label">Days</p>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((day, i) => (
            <Pill
              key={day}
              on={p.gym.days.includes(i)}
              onClick={() => set((d) => void (d.gym.days = toggle(d.gym.days, i).sort()))}
            >
              {day}
            </Pill>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start">
            <input
              type="time"
              className="field-input"
              value={time(p.gym.start)}
              onChange={(e) => set((d) => void (d.gym.start = mins(e.target.value)))}
            />
          </Field>
          <Field label="Minutes">
            <input
              className="field-input"
              inputMode="numeric"
              value={p.gym.minutes}
              onChange={(e) => set((d) => void (d.gym.minutes = Number(e.target.value) || 75))}
            />
          </Field>
          <Field label="Bench goal kg">
            <input
              className="field-input"
              inputMode="numeric"
              value={p.gym.benchGoalKg ?? ""}
              onChange={(e) => set((d) => void (d.gym.benchGoalKg = Number(e.target.value) || null))}
              placeholder="100"
            />
          </Field>
        </div>
        <Check checked={p.gym.returning} onChange={() => set((d) => void (d.gym.returning = !d.gym.returning))}>
          Coming back after a break: start a rep easier for two weeks
        </Check>
        <p className="field-label">My gym doesn&apos;t have</p>
        <div className="flex flex-wrap gap-2">
          {MISSING.map(([k, label]) => (
            <Pill
              key={k}
              on={p.gym.missing.includes(k)}
              onClick={() => set((d) => void (d.gym.missing = toggle(d.gym.missing, k)))}
            >
              {label}
            </Pill>
          ))}
        </div>
      </Section>

      <Section title="Shopping">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Weekly budget £">
            <input
              className="field-input"
              inputMode="decimal"
              value={p.shopping.budgetPence !== null ? p.shopping.budgetPence / 100 : ""}
              onChange={(e) =>
                set(
                  (d) =>
                    void (d.shopping.budgetPence = e.target.value ? Math.round(Number(e.target.value) * 100) : null),
                )
              }
              placeholder="60"
            />
          </Field>
          <Field label="Delivery day">
            <select
              className="field-input"
              value={p.shopping.deliveryWeekday ?? ""}
              onChange={(e) =>
                set((d) => void (d.shopping.deliveryWeekday = e.target.value === "" ? null : Number(e.target.value)))
              }
            >
              <option value="">Not fixed</option>
              {DAYS.map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 md:bottom-4">
        <button type="submit" disabled={pending} aria-busy={pending} className="btn-life w-full shadow-2xl sm:w-auto">
          {pending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Section({ title, hint, children, id }: { title: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3 card-life">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint && <p className="text-sm text-neutral-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-5 w-5 shrink-0 accent-[var(--color-mint)]"
      />
      <span>{children}</span>
    </label>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`min-h-10 rounded-full px-3.5 text-sm ring-1 ${on ? "bg-mint/15 text-mint ring-mint/40" : "bg-white/5 text-neutral-300 ring-white/10"}`}
    >
      {children}
    </button>
  );
}

function RuleRow({
  label,
  detail,
  rule,
  mixed,
  onLevel,
  forms,
}: {
  label: string;
  detail?: string;
  rule?: Rule;
  mixed?: boolean;
  onLevel: (l: "avoid" | "flag" | null) => void;
  forms?: ReactNode;
}) {
  const level = rule?.level ?? null;
  return (
    <div className="space-y-2 rounded-xl bg-white/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{label}</p>
          {detail && <p className="text-xs text-neutral-400">{detail}</p>}
          {mixed && <p className="text-xs text-sand">Set differently per item</p>}
        </div>
        <div className="flex gap-1" role="group" aria-label={`${label} rule`}>
          {(
            [
              [null, "Fine"],
              ["flag", "Flag"],
              ["avoid", "Avoid"],
            ] as const
          ).map(([l, text]) => (
            <button
              key={text}
              type="button"
              aria-pressed={!mixed && level === l}
              onClick={() => onLevel(l)}
              className={`min-h-9 rounded-lg px-3 text-xs ${!mixed && level === l ? (l === "avoid" ? "bg-coral text-white" : l === "flag" ? "bg-sand text-primary" : "bg-mint text-primary") : "bg-white/5 text-neutral-400"}`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      {forms}
    </div>
  );
}
