"use client";

import Image from "next/image";
import { useEffect, useOptimistic, useState, useSyncExternalStore, useTransition } from "react";
import { DRAWING_CREDIT, type Demo } from "@/lib/life/gym/media";
import { nextSet, setLabel } from "@/lib/life/gym/next-set";
import { toast } from "@/components/toaster";
import { gymSession, logSet } from "../actions";
import { Stars } from "../kit";

export type ItemView = {
  key: string;
  name: string;
  swappedFrom: string | null;
  perSide: boolean;
  cues: string[];
  back: string | null;
  demo: Demo;
  weighted: boolean;
  /** Bodyweight moves: the weight box is extra weight on a belt, empty for none, or minus for machine help. */
  added: boolean;
  /** The lightest weight a set may log: below zero only for the help on a bodyweight move. */
  lowest: number;
  unit: "reps" | "s" | "m";
  step: number;
  rest: number;
  scheme: string;
  note: string | null;
  range: [number, number];
  rir: number;
  target: { kg: number | null; reps: number }[];
  change: "up" | "same" | "down" | "new";
  why: string;
  logged: { position: number; kg: number | null; reps: number; rir: number | null }[];
};
export type BlockView = { title: string; superset: boolean; items: ItemView[] };

type Logged = Record<string, { kg: number | null; reps: number; rir: number | null }>;

const rowId = (key: string, position: number) => `set-${key}-${position}`;
const FINISH = "finish-session";

/**
 * Brings a set's row, or the Finish card, to the middle of the screen, clear of the
 * bars that stick to its edges, and puts the focus on its button. Only ever on a
 * tap: the page never moves by itself in the middle of a set.
 */
function goTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const calm = window.matchMedia(REDUCED_MOTION).matches;
  target.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
  document.getElementById(`${id}-button`)?.focus({ preventScroll: true });
}

export function SessionLogger({
  day,
  workout,
  warmup,
  blocks,
  finished,
  feel,
  notes,
  started,
}: {
  day: string;
  workout: string;
  warmup: string[];
  blocks: BlockView[];
  finished: boolean;
  feel: number | null;
  notes: string;
  started: boolean;
}) {
  const initial: Logged = {};
  for (const b of blocks) for (const i of b.items) for (const l of i.logged) initial[`${i.key}:${l.position}`] = l;
  const [, start] = useTransition();
  const [logged, setLogged] = useOptimistic(initial, (cur, change: { id: string; value: Logged[string] | null }) => {
    const next = { ...cur };
    if (change.value) next[change.id] = change.value;
    else delete next[change.id];
    return next;
  });
  const [rest, setRest] = useState<{ until: number; total: number; name: string } | null>(null);
  const [warm, setWarm] = useState<boolean[]>(() => warmup.map(() => false));
  const [rating, setRating] = useState<number | null>(feel);
  const [note, setNote] = useState(notes);

  const total = blocks.reduce((n, b) => n + b.items.reduce((m, i) => m + i.target.length, 0), 0);
  const done = Object.keys(logged).length;

  // The next set, worked out from what is ticked. It has no state of its own, so it
  // moves the moment a set is ticked and is the same after a reload.
  const next = nextSet(
    blocks.map((b) => ({ superset: b.superset, items: b.items.map((i) => ({ key: i.key, sets: i.target.length })) })),
    new Set(Object.keys(logged)),
  );
  const nextItem = next ? blocks.flatMap((b) => b.items).find((i) => i.key === next.key) : undefined;
  const nextLabel =
    next && nextItem
      ? setLabel(nextItem, next.position, {
          kg: suggestKg(nextItem, next.position, logged),
          reps: (nextItem.target[next.position - 1] ?? { reps: nextItem.range[0] }).reps,
        })
      : null;
  const jump = () => goTo(next ? rowId(next.key, next.position) : FINISH);

  const save = (item: ItemView, position: number, value: Logged[string] | null) =>
    start(async () => {
      setLogged({ id: `${item.key}:${position}`, value });
      if (value && !finished) setRest({ until: Date.now() + item.rest * 1000, total: item.rest, name: item.name });
      const r = await logSet({
        day,
        workout,
        exercise: item.key,
        position,
        kg: value?.kg ?? null,
        reps: value ? value.reps : null,
        rir: value?.rir ?? null,
      });
      if (r.error) toast(r.error, { tone: "error" });
    });

  return (
    <>
      <div className="sticky top-14 z-10 -mx-5 space-y-2 bg-primary/90 px-5 py-2 backdrop-blur-sm sm:mx-0 sm:rounded-xl sm:px-3">
        {!finished && (
          <button
            type="button"
            onClick={jump}
            className="flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-xl bg-white/8 px-3 text-left text-sm ring-1 ring-white/10 transition hover:bg-white/15"
          >
            <span className="shrink-0 text-xs font-semibold text-mint">{nextLabel ? "Next" : "All sets done"}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{nextLabel ?? "Finish the session"}</span>
            <span className="shrink-0 text-muted" aria-hidden>
              ›
            </span>
          </button>
        )}
        <div className="flex items-center gap-3">
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-label="Sets done"
          >
            <div
              className="h-full rounded-full bg-mint transition-all"
              style={{ width: `${total ? (done / total) * 100 : 0}%` }}
            />
          </div>
          <span className="text-xs text-body tabular-nums">
            {done}/{total} sets
          </span>
        </div>
      </div>

      <section className="space-y-2 card-life" aria-labelledby="warmup-title">
        <h2 id="warmup-title" className="font-semibold">
          Warm-up · 10 minutes
        </h2>
        <ul className="space-y-1">
          {warmup.map((w, i) => (
            <li key={w}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={warm[i]}
                  onChange={() => setWarm((x) => x.map((v, j) => (j === i ? !v : v)))}
                  className="mt-0.5 size-5 shrink-0 accent-mint"
                />
                <span className={warm[i] ? "text-faint line-through" : ""}>{w}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {blocks.map((b) => (
        <section key={b.title} className="space-y-3" aria-label={b.title}>
          <h2 className="px-1 eyebrow">
            {b.title}
            {b.superset ? " · alternate between these" : ""}
          </h2>
          {b.items.map((item) => (
            <Exercise
              key={item.key}
              item={item}
              logged={logged}
              onSave={save}
              next={!finished && next?.key === item.key ? next.position : null}
            />
          ))}
        </section>
      ))}

      <section id={FINISH} className="scroll-mt-40 space-y-3 card-life" aria-labelledby="finish-title">
        <h2 id="finish-title" className="font-semibold">
          {finished ? "Session done" : "Finish"}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-body">How did it feel?</span>
          <Stars value={rating} onChange={setRating} />
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Anything to remember: a twinge, a PR, the gym was packed"
          className="field-input"
        />
        <div className="flex flex-wrap gap-2">
          <button
            id={`${FINISH}-button`}
            type="button"
            disabled={!started && done === 0}
            onClick={() =>
              start(async () => {
                const r = await gymSession({ day, workout, finished: true, feel: rating, notes: note });
                if (r.error) toast(r.error, { tone: "error" });
                else {
                  setRest(null);
                  toast(finished ? "Saved." : "Session logged. Eat your breakfast.");
                }
              })
            }
            className="btn-life"
          >
            {finished ? "Save" : "Finish session"}
          </button>
          {finished && (
            <button
              type="button"
              onClick={() => start(async () => void (await gymSession({ day, workout, finished: false })))}
              className="btn-soft"
            >
              Reopen
            </button>
          )}
        </div>
      </section>

      {rest && <RestBar rest={rest} onDone={() => setRest(null)} next={nextLabel} onJump={nextLabel ? jump : null} />}
    </>
  );
}

function Exercise({
  item,
  logged,
  onSave,
  next,
}: {
  item: ItemView;
  logged: Logged;
  onSave: (item: ItemView, position: number, value: Logged[string] | null) => void;
  /** The number of this exercise's set that comes next in the session, when it is this one's turn. */
  next: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState(0);
  const positions = Math.max(item.target.length, ...item.logged.map((l) => l.position), 0) + extra;
  const range = item.range[0] === item.range[1] ? `${item.range[0]}` : `${item.range[0]}–${item.range[1]}`;
  const unitLabel = item.unit === "reps" ? "reps" : item.unit;
  return (
    <article className="space-y-3 card-life">
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-lg font-semibold">{item.name}</h3>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="-my-1.5 tap shrink-0 rounded-full px-3 text-xs text-mint hover:bg-mint/10"
            aria-expanded={open}
          >
            {open ? "Hide tips" : "How"}
          </button>
        </div>
        <p className="text-sm text-body">
          {item.note ?? `${item.target.length} × ${range} ${unitLabel}${item.perSide ? " a side" : ""}`}
          {item.scheme !== "power" && item.scheme !== "timed" ? ` · stop with ${item.rir} in the tank` : ""}
        </p>
        <p
          className={`text-xs ${item.change === "up" ? "text-mint" : item.change === "down" ? "text-sand" : "text-muted"}`}
        >
          {item.why}
        </p>
        {item.added && item.weighted && (
          <p className="text-xs text-muted">
            On an assisted machine, tap ± so the help logs as minus: 35 kg of help is −35.
          </p>
        )}
        {item.swappedFrom && (
          <p className="text-xs text-faint">In place of {item.swappedFrom}, which your gym lacks.</p>
        )}
        {open && (
          <div className="space-y-2 pt-1 text-sm text-body">
            {item.demo.frames && <Movement frames={item.demo.frames} name={item.name} />}
            <a
              href={item.demo.video}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/5 px-4 text-sm text-mint ring-1 ring-mint/25 hover:bg-white/10"
            >
              <span aria-hidden>▶</span> Watch a short demo
            </a>
            <ul className="list-disc space-y-0.5 pl-5">
              {item.cues.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            {item.back && <p className="text-xs text-aqua">Back: {item.back}</p>}
          </div>
        )}
      </header>
      <ol className="space-y-2">
        {Array.from({ length: positions }, (_, i) => i + 1).map((pos) => (
          <SetRow
            key={pos}
            item={item}
            position={pos}
            target={item.target[pos - 1] ?? item.target[item.target.length - 1] ?? { kg: null, reps: item.range[0] }}
            suggest={suggestKg(item, pos, logged)}
            logged={logged[`${item.key}:${pos}`]}
            onSave={onSave}
            isNext={pos === next}
          />
        ))}
      </ol>
      <button
        type="button"
        onClick={() => setExtra((n) => n + 1)}
        className="tap w-full bg-white/5 text-sm text-muted hover:bg-white/10 hover:text-white"
      >
        + Add a set
      </button>
    </article>
  );
}

/**
 * A weight for a set with no target yet: the set before it, or 90% of the top
 * set for back-offs (rounded down). So after the first set, the rest fill in.
 */
function suggestKg(item: ItemView, position: number, logged: Logged): number | null {
  if (item.target[position - 1]?.kg != null) return item.target[position - 1].kg;
  for (let p = position - 1; p >= 1; p--) {
    const prev = logged[`${item.key}:${p}`]?.kg;
    if (prev == null) continue;
    if (item.scheme === "top-backoff" && p === 1)
      return item.step ? Math.floor((prev * 0.9) / item.step) * item.step : prev;
    return prev;
  }
  return null;
}

/**
 * The movement as a two-frame loop: start, then end, then start. With reduced
 * motion turned on, both frames sit side by side instead. The line drawings are
 * inverted to white so they suit the dark page.
 */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function Movement({ frames, name }: { frames: [string, string]; name: string }) {
  const [frame, setFrame] = useState(0);
  // Read from the browser, not copied into state, so it also follows a change
  // to the setting while the page is open. The server renders the moving version.
  const still = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
  useEffect(() => {
    if (still) return;
    const id = window.setInterval(() => setFrame((f) => 1 - f), 1000);
    return () => window.clearInterval(id);
  }, [still]);
  const picture = (src: string, label: string, shown: boolean) => (
    <Image
      key={src}
      src={src}
      alt={label}
      fill
      unoptimized
      sizes="20rem"
      className={`object-contain p-2 invert transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
    />
  );
  return (
    <figure className="space-y-1">
      {still ? (
        <div className="grid grid-cols-2 gap-2">
          {frames.map((src, i) => (
            <div key={src} className="relative aspect-square overflow-hidden rounded-xl bg-black">
              {picture(src, `${name}, ${i === 0 ? "start" : "end"}`, true)}
            </div>
          ))}
        </div>
      ) : (
        <div
          className="relative mx-auto aspect-square w-full max-w-[16rem] overflow-hidden rounded-xl bg-black"
          role="img"
          aria-label={`${name}: the movement from start to end`}
        >
          {picture(frames[0], "", frame === 0)}
          {picture(frames[1], "", frame === 1)}
          <span className="absolute bottom-2 left-2 rounded-full bg-white/10 px-2 py-0.5 text-3xs text-body">
            {frame === 0 ? "Start" : "End"}
          </span>
        </div>
      )}
      <figcaption className="text-center text-3xs text-faint">
        Drawing:{" "}
        <a href={DRAWING_CREDIT.source} target="_blank" rel="noreferrer noopener" className="underline">
          {DRAWING_CREDIT.by}
        </a>
        ,{" "}
        <a href={DRAWING_CREDIT.licenseUrl} target="_blank" rel="noreferrer noopener" className="underline">
          {DRAWING_CREDIT.license}
        </a>
      </figcaption>
    </figure>
  );
}

function SetRow({
  item,
  position,
  target,
  suggest,
  logged,
  onSave,
  isNext,
}: {
  item: ItemView;
  position: number;
  target: { kg: number | null; reps: number };
  suggest: number | null;
  logged?: Logged[string];
  onSave: (item: ItemView, position: number, value: Logged[string] | null) => void;
  /** The set the session comes to next: marked, so it is easy to find after a jump. */
  isNext: boolean;
}) {
  // Untouched, the weight follows the suggestion; once typed in, it is yours.
  const [typed, setKg] = useState<string | null>(logged?.kg != null ? logged.kg.toString() : null);
  const kg = typed ?? suggest?.toString() ?? "";
  const [reps, setReps] = useState((logged?.reps ?? target.reps).toString());
  const [rir, setRir] = useState(
    logged?.rir?.toString() ?? (item.scheme === "power" || item.scheme === "timed" ? "" : item.rir.toString()),
  );
  const done = Boolean(logged);
  const step = item.step || 2.5;
  const bump = (d: number) => setKg(String(Math.max(item.lowest, Math.round(((Number(kg) || 0) + d) * 100) / 100)));
  // On a bodyweight move a minus weight is the help from an assisted machine.
  const help = item.added && Number(kg) < 0;
  return (
    <li
      id={rowId(item.key, position)}
      aria-current={isNext && !done ? "step" : undefined}
      className={`flex scroll-mt-40 scroll-mb-48 flex-wrap items-center gap-2 rounded-xl p-2 ${done ? "bg-mint/10 ring-1 ring-mint/25" : isNext ? "bg-white/5 ring-1 ring-mint/60" : "bg-white/5"}`}
    >
      <span className="w-6 text-center text-xs text-muted tabular-nums">{position}</span>
      {item.weighted && (
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => bump(-step)}
            className="tap h-11 w-9 text-lg text-muted"
            aria-label="Less weight"
          >
            −
          </button>
          <label className="flex items-baseline gap-1">
            <span className="sr-only">
              {item.added ? "Added weight, or minus for machine help," : "Weight"} in kg, set {position}
            </span>
            <input
              inputMode="decimal"
              value={kg}
              onChange={(e) => setKg(e.target.value.replace(",", "."))}
              placeholder={item.added ? "+0" : "kg"}
              className="h-11 w-16 rounded-lg bg-white/10 text-center text-base tabular-nums"
            />
            <span className="text-xs text-muted">{item.added ? (help ? "kg help" : "+kg") : "kg"}</span>
          </label>
          <button
            type="button"
            onClick={() => bump(step)}
            className="tap h-11 w-9 text-lg text-muted"
            aria-label="More weight"
          >
            +
          </button>
          {item.added && (
            <button
              type="button"
              onClick={() => setKg(String(-(Number(kg) || 0)))}
              className="tap size-11 text-lg text-muted"
              aria-label={`Machine help, not added weight, set ${position}`}
              aria-pressed={help}
            >
              ±
            </button>
          )}
        </div>
      )}
      <label className="flex items-baseline gap-1">
        <span className="sr-only">
          {item.unit === "reps" ? "Reps" : item.unit === "s" ? "Seconds" : "Metres"}, set {position}
        </span>
        <input
          inputMode="numeric"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          className="h-11 w-14 rounded-lg bg-white/10 text-center text-base tabular-nums"
        />
        <span className="text-xs text-muted">{item.unit === "reps" ? "reps" : item.unit}</span>
      </label>
      {item.scheme !== "power" && item.scheme !== "timed" && (
        <label className="flex items-center gap-1 text-xs text-muted">
          <span className="sr-only">Reps left in the tank</span>
          <select
            value={rir}
            onChange={(e) => setRir(e.target.value)}
            className="h-11 rounded-lg bg-white/10 px-2 text-sm text-white"
            aria-label={`Reps left in the tank, set ${position}`}
          >
            <option value="">left?</option>
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n === 4 ? "4+ left" : `${n} left`}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={() => {
          if (done) return onSave(item, position, null);
          const r = Number(reps);
          if (!Number.isFinite(r) || r < 0) return toast("Enter how many you did.", { tone: "error" });
          const k = item.weighted ? (kg.trim() === "" ? null : Number(kg)) : null;
          if (k !== null && !Number.isFinite(k)) return toast("Enter the weight in kg.", { tone: "error" });
          onSave(item, position, { kg: k, reps: r, rir: rir === "" ? null : Number(rir) });
        }}
        id={`${rowId(item.key, position)}-button`}
        aria-pressed={done}
        aria-label={done ? `Undo set ${position}` : `Done set ${position}`}
        className={`ml-auto tap size-11 rounded-full text-lg ring-1 ${done ? "bg-mint text-primary ring-mint" : "text-mint ring-mint/40 hover:bg-mint/10"}`}
      >
        ✓
      </button>
    </li>
  );
}

function RestBar({
  rest,
  onDone,
  next,
  onJump,
}: {
  rest: { until: number; total: number; name: string };
  onDone: () => void;
  /** The set that comes next, as the bar at the top names it. Null when every set is done. */
  next: string | null;
  onJump: (() => void) | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((rest.until - now) / 1000));
  useEffect(() => {
    if (left === 0) {
      if ("vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
      const id = window.setTimeout(onDone, 4000);
      return () => window.clearTimeout(id);
    }
  }, [left, onDone]);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  const line = next
    ? left === 0
      ? `Go: ${next}`
      : `Rest, then ${next}`
    : left === 0
      ? "Go: every set is done"
      : `Rest after ${rest.name}`;
  const body = (
    <>
      <span className="block truncate text-xs text-body">{line}</span>
      <span className="block text-2xl font-bold tabular-nums">{left === 0 ? "Now" : `${mm}:${ss}`}</span>
      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10">
        <span className="block h-full bg-mint" style={{ width: `${(1 - left / rest.total) * 100}%` }} />
      </span>
    </>
  );
  return (
    <div
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-2xl bg-fern px-4 py-3 shadow-2xl ring-1 ring-mint/30 md:inset-x-auto md:right-6 md:bottom-6 md:w-80"
      role="timer"
      aria-live="off"
    >
      {onJump ? (
        // The whole of it is the way to the next set: tap it when the rest is over, or before.
        <button type="button" onClick={onJump} className="min-w-0 flex-1 cursor-pointer text-left">
          {body}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}
      <button type="button" onClick={onDone} className="btn-soft px-3 py-1.5 text-sm">
        Skip
      </button>
    </div>
  );
}
