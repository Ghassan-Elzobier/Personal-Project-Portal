"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { layoutLanes, snap } from "@/lib/portal/lanes";
import { LIFE_KINDS, REPEATS, type LifeKind, type Repeat } from "@/lib/calendar/life-blocks";
import type { Block, Unscheduled } from "@/lib/portal/schedule";
import { clock, parseClock, shortDate } from "@/lib/dates/week";
import { TaskLink } from "@/components/ui";
import {
  addLifeBlock,
  addStudySession,
  moveBlock,
  removeLifeBlock,
  scheduleTask,
  unscheduleTask,
  type ActionResult,
} from "./actions";

// From 05:00, so an early weigh-in, breakfast and gym session fit on the grid.
const DAY_START = 5 * 60;
const DAY_END = 24 * 60;
const PX_PER_MIN = 0.9;
const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240];
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Dialog =
  | { mode: "new"; date: string; start: number; tab: "life" | "work"; gid?: string }
  | { mode: "edit"; block: Block }
  | { mode: "plan"; block: Block };

type DragData =
  { type: "task"; gid: string } | { type: "block"; source: Movable; id: string; duration: number; grab: number };

/** Blocks the grid can move. The Life plan's items move with the plan, in Life. */
type Movable = Exclude<Block["source"], "plan">;

const rawId = (block: Block) => block.id.split(":")[0];

const isStudy = (block: Block) => block.source === "asana" || block.source === "session";

/** What a tap on a block opens: the Life plan's items explain themselves, the rest can be edited. */
const dialogFor = (block: Block): Dialog =>
  block.source === "plan" ? { mode: "plan", block } : { mode: "edit", block };

/** A day's planned study, such as "3.5 h". Life blocks do not count. */
function plannedHours(blocks: Block[]): string {
  const minutes = blocks.filter(isStudy).reduce((sum, b) => sum + (b.end - b.start), 0);
  return minutes ? `${Math.round((minutes / 60) * 100) / 100} h` : "";
}

/** Tasks to plan, soonest first: what is due this week, then later, then undated. */
function planGroups(tasks: Unscheduled[], weekEnd: string): { title: string; tasks: Unscheduled[] }[] {
  return [
    { title: "Due by this week", tasks: tasks.filter((t) => t.dueOn && t.dueOn <= weekEnd) },
    { title: "Later", tasks: tasks.filter((t) => t.dueOn && t.dueOn > weekEnd) },
    { title: "No date", tasks: tasks.filter((t) => !t.dueOn) },
  ].filter((g) => g.tasks.length);
}

export function WeekPlanner({
  days,
  blocks,
  unscheduled,
  today,
  nowMinutes,
  googleReady,
}: {
  days: string[];
  blocks: Block[];
  unscheduled: Unscheduled[];
  today: string;
  nowMinutes: number;
  googleReady: boolean;
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [chosenDay, setMobileDay] = useState(days.includes(today) ? today : days[0]);
  // Derived, so a week change can never leave the phone view on a day from another week.
  const mobileDay = days.includes(chosenDay) ? chosenDay : days.includes(today) ? today : days[0];
  const scroller = useRef<HTMLDivElement>(null);

  // Open the grid an hour before now (or at 07:00), not at the top of the day.
  useEffect(() => {
    const focus = days.includes(today) ? Math.max(nowMinutes - 60, 7 * 60) : 8 * 60;
    if (scroller.current) scroller.current.scrollTop = (focus - DAY_START) * PX_PER_MIN;
  }, [days, today, nowMinutes]);

  const run = (action: () => Promise<ActionResult>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else setDialog(null);
    });
  };

  const byDay = useMemo(() => {
    const map = new Map<string, Block[]>();
    for (const d of days) map.set(d, []);
    for (const b of blocks) map.get(b.date)?.push(b);
    return map;
  }, [days, blocks]);

  const onDrop = (date: string, e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    let data: DragData;
    try {
      data = JSON.parse(e.dataTransfer.getData("application/x-portal"));
    } catch {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const grab = data.type === "block" ? data.grab : 0;
    const start = snap(DAY_START + (e.clientY - rect.top - grab) / PX_PER_MIN);
    if (data.type === "task") {
      run(() => scheduleTask({ gid: data.gid, date, start, duration: 60 }));
    } else {
      run(() =>
        moveBlock({
          source: data.source,
          id: data.id,
          date,
          start,
          duration: Math.min(data.duration, DAY_END - start),
        }),
      );
    }
  };

  const hours = Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => DAY_START + i * 60);
  const height = (DAY_END - DAY_START) * PX_PER_MIN;

  return (
    <div className="relative">
      {(pending || error) && (
        <div
          className={`fixed right-4 bottom-4 z-40 rounded-xl px-4 py-3 text-sm shadow-lg ring-1 ${error ? "bg-coral/15 text-coral ring-coral/40" : "bg-navy text-neutral-200 ring-white/10"}`}
          role="status"
        >
          {pending ? "Saving…" : error}
          {error && (
            <button className="ml-3 cursor-pointer text-neutral-400 hover:text-white" onClick={() => setError(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        {/* Week grid, tablet and up */}
        <div className="hidden overflow-hidden card p-0 md:block">
          <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-white/5">
            <div />
            {days.map((d, i) => (
              <div
                key={d}
                className={`px-2 py-3 text-center text-sm ${d === today ? "text-white" : "text-neutral-400"}`}
              >
                <span className="block text-xs tracking-wider uppercase">{WEEKDAY[i]}</span>
                <span
                  className={`mt-1 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 font-semibold ${d === today ? "bg-lavender" : ""}`}
                >
                  {Number(d.slice(8))}
                </span>
                <span className="mt-1 block h-4 text-[11px] text-neutral-400 tabular-nums" title="Planned study time">
                  {plannedHours(byDay.get(d) ?? [])}
                </span>
              </div>
            ))}
          </div>
          <div ref={scroller} className="max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-[3.5rem_repeat(7,1fr)]" style={{ height }}>
              <div className="relative">
                {hours.map((h) => (
                  <span
                    key={h}
                    className="absolute right-2 -translate-y-1/2 text-[11px] text-neutral-400 tabular-nums"
                    style={{ top: (h - DAY_START) * PX_PER_MIN }}
                  >
                    {h === DAY_START ? "" : clock(h)}
                  </span>
                ))}
              </div>
              {days.map((d) => (
                <DayColumn
                  key={d}
                  date={d}
                  blocks={byDay.get(d) ?? []}
                  hours={hours}
                  isToday={d === today}
                  nowMinutes={nowMinutes}
                  onDrop={(e) => onDrop(d, e)}
                  onEmptyClick={(start) =>
                    setDialog({ mode: "new", date: d, start, tab: googleReady ? "life" : "work" })
                  }
                  onBlockClick={(block) => setDialog(dialogFor(block))}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Day agenda, phones */}
        <div className="space-y-3 md:hidden">
          <div className="flex gap-1 overflow-x-auto pb-1">
            {days.map((d, i) => (
              <button
                key={d}
                onClick={() => setMobileDay(d)}
                className={`btn shrink-0 flex-col gap-0 px-3 py-1.5 ring-1 ${d === mobileDay ? "bg-lavender text-white ring-lavender" : "bg-white/5 text-neutral-300 ring-white/10"}`}
              >
                <span className="text-[10px] uppercase">{WEEKDAY[i]}</span>
                <span>{Number(d.slice(8))}</span>
              </button>
            ))}
          </div>
          <ul className="space-y-2">
            {(byDay.get(mobileDay) ?? []).map((b) => (
              <li key={b.id}>
                <button className="w-full text-left" onClick={() => setDialog(dialogFor(b))}>
                  <BlockCard block={b} compact={false} />
                </button>
              </li>
            ))}
            {(byDay.get(mobileDay) ?? []).length === 0 && (
              <li className="rounded-xl bg-white/5 p-4 text-sm text-neutral-400">Nothing planned.</li>
            )}
          </ul>
          <button
            className="btn-primary w-full"
            onClick={() =>
              setDialog({ mode: "new", date: mobileDay, start: 9 * 60, tab: googleReady ? "life" : "work" })
            }
          >
            Add to {shortDate(mobileDay)}
          </button>
        </div>

        {/* Tasks to plan */}
        <aside className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">To plan</h2>
            <p className="text-xs text-neutral-400">Drag a task onto a time, or tap Plan.</p>
          </div>
          {unscheduled.length === 0 && (
            <p className="rounded-xl bg-white/5 p-3 text-sm text-neutral-400">Every open task has a time.</p>
          )}
          <ul className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            {planGroups(unscheduled, days[6]).map((g) => (
              <li key={g.title}>
                <details open={g.title !== "No date"}>
                  <summary className="mb-1 cursor-pointer text-xs font-semibold text-neutral-300">
                    {g.title} <span className="font-normal text-neutral-400">{g.tasks.length}</span>
                  </summary>
                  <ul className="space-y-2">
                    {g.tasks.map((t) => (
                      <li
                        key={t.gid}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "application/x-portal",
                            JSON.stringify({ type: "task", gid: t.gid } satisfies DragData),
                          );
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        className="group cursor-grab rounded-xl bg-white/5 p-3 text-sm ring-1 ring-white/5 transition hover:ring-lavender/40 active:cursor-grabbing"
                      >
                        <p className="text-[11px] tracking-wider text-neutral-400 uppercase">{t.project}</p>
                        <p className="font-medium">{t.title}</p>
                        <div className="mt-1 flex items-center justify-between text-xs text-neutral-400">
                          <span>{t.dueOn ? `Due ${shortDate(t.dueOn)}` : "No date"}</span>
                          <button
                            className="cursor-pointer text-aqua hover:text-white"
                            onClick={() =>
                              setDialog({
                                mode: "new",
                                date:
                                  t.dueOn && days.includes(t.dueOn) ? t.dueOn : days.includes(today) ? today : days[0],
                                start: 9 * 60,
                                tab: "work",
                                gid: t.gid,
                              })
                            }
                          >
                            Plan
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
          <Legend />
        </aside>
      </div>

      {dialog && (
        <Modal onClose={() => setDialog(null)}>
          {dialog.mode === "new" ? (
            <NewBlockForm
              key={`${dialog.date}-${dialog.start}-${dialog.gid ?? ""}`}
              dialog={dialog}
              days={days}
              unscheduled={unscheduled}
              googleReady={googleReady}
              pending={pending}
              onSubmitLife={(input) => run(() => addLifeBlock(input))}
              onSubmitWork={(input) => run(() => scheduleTask(input))}
            />
          ) : dialog.mode === "plan" ? (
            <PlanBlockInfo block={dialog.block} />
          ) : (
            <EditBlockForm
              key={dialog.block.id}
              block={dialog.block}
              days={days}
              pending={pending}
              googleReady={googleReady}
              onAddSession={(date, start, duration) =>
                run(() => addStudySession({ gid: dialog.block.taskGid ?? rawId(dialog.block), date, start, duration }))
              }
              onMove={(date, start, duration) =>
                run(() =>
                  moveBlock({ source: dialog.block.source as Movable, id: rawId(dialog.block), date, start, duration }),
                )
              }
              onUnschedule={() => run(() => unscheduleTask({ gid: rawId(dialog.block), date: dialog.block.date }))}
              onDelete={(wholeSeries) => run(() => removeLifeBlock({ id: rawId(dialog.block), wholeSeries }))}
            />
          )}
          {error && <p className="mt-4 text-sm text-coral">{error}</p>}
        </Modal>
      )}
    </div>
  );
}

function DayColumn({
  date,
  blocks,
  hours,
  isToday,
  nowMinutes,
  onDrop,
  onEmptyClick,
  onBlockClick,
}: {
  date: string;
  blocks: Block[];
  hours: number[];
  isToday: boolean;
  nowMinutes: number;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onEmptyClick: (start: number) => void;
  onBlockClick: (block: Block) => void;
}) {
  const [over, setOver] = useState(false);
  const visible = blocks.filter((b) => b.end > DAY_START);
  const lanes = layoutLanes(visible.map((b) => ({ id: b.id, start: Math.max(b.start, DAY_START), end: b.end })));

  return (
    <div
      className={`relative border-l border-white/5 transition-colors ${over ? "bg-lavender/10" : isToday ? "bg-white/2" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        onDrop(e);
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onEmptyClick(snap(DAY_START + (e.clientY - rect.top) / PX_PER_MIN, 30));
      }}
      aria-label={`Schedule for ${date}`}
    >
      {hours.map((h) => (
        <div
          key={h}
          className="pointer-events-none absolute inset-x-0 border-t border-white/5"
          style={{ top: (h - DAY_START) * PX_PER_MIN }}
        />
      ))}
      {isToday && nowMinutes >= DAY_START && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-coral"
          style={{ top: (nowMinutes - DAY_START) * PX_PER_MIN }}
        >
          <span className="absolute -top-1.5 -left-1 size-3 rounded-full bg-coral" />
        </div>
      )}
      {visible.map((b) => {
        const lane = lanes.get(b.id)!;
        const top = (Math.max(b.start, DAY_START) - DAY_START) * PX_PER_MIN;
        const h = Math.max((b.end - Math.max(b.start, DAY_START)) * PX_PER_MIN, 18);
        return (
          <button
            key={b.id}
            draggable={b.editable}
            onDragStart={(e) => {
              if (b.source === "plan") return e.preventDefault();
              const grab = e.clientY - e.currentTarget.getBoundingClientRect().top;
              const data: DragData = { type: "block", source: b.source, id: rawId(b), duration: b.end - b.start, grab };
              e.dataTransfer.setData("application/x-portal", JSON.stringify(data));
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onBlockClick(b)}
            title={b.note}
            className="absolute z-20 overflow-hidden p-0.5 text-left"
            style={{
              top,
              height: h,
              left: `${(lane.lane / lane.lanes) * 100}%`,
              width: `${100 / lane.lanes}%`,
            }}
          >
            <BlockCard block={b} compact />
          </button>
        );
      })}
    </div>
  );
}

function blockStyle(block: Block): string {
  if (block.source === "asana") {
    return block.completed
      ? "bg-royal/30 ring-royal/40 text-neutral-300"
      : "bg-gradient-to-b from-royal to-lavender ring-lavender/60 text-white";
  }
  if (block.source === "session") {
    return block.completed
      ? "bg-royal/20 ring-royal/30 text-neutral-300"
      : "bg-gradient-to-b from-royal/60 to-lavender/50 ring-lavender/40 text-white";
  }
  if (block.source === "plan" && block.clash)
    return `${LIFE_KINDS[(block.kind ?? "other") as LifeKind]?.className ?? LIFE_KINDS.other.className} !ring-2 !ring-coral`;
  if (block.kind && block.kind in LIFE_KINDS) return LIFE_KINDS[block.kind as LifeKind].className;
  return "bg-white/5 ring-white/15 text-neutral-400 [background-image:repeating-linear-gradient(45deg,transparent_0,transparent_6px,rgba(255,255,255,0.04)_6px,rgba(255,255,255,0.04)_12px)]";
}

function BlockCard({ block, compact }: { block: Block; compact: boolean }) {
  const short = block.end - block.start < 45;
  return (
    <span
      className={`flex size-full flex-col rounded-lg px-2 text-xs ring-1 ${compact && block.end - block.start < 25 ? "py-0 leading-4" : "py-1"} transition hover:brightness-110 ${blockStyle(block)} ${block.editable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <span
        className={`font-semibold ${compact ? (short ? "truncate" : "line-clamp-2") : ""} ${block.completed ? "line-through" : ""}`}
      >
        {block.title}
      </span>
      {(!compact || !short) && (
        <span className="opacity-75">
          {clock(block.start)}–{clock(block.end)}
          {block.project ? ` · ${block.project}` : ""}
        </span>
      )}
      {!compact && block.note && (
        <span className={`mt-0.5 ${block.clash ? "text-coral" : "opacity-75"}`}>{block.note}</span>
      )}
    </span>
  );
}

function Legend() {
  return (
    <div className="space-y-1 pt-4 text-xs text-neutral-400">
      <p className="flex items-center gap-2">
        <span className="size-3 rounded-sm bg-linear-to-b from-royal to-lavender" /> Study: when a task is due
      </p>
      <p className="flex items-center gap-2">
        <span className="size-3 rounded-sm bg-linear-to-b from-royal/60 to-lavender/50" /> Study sessions on a task
      </p>
      <p className="flex items-center gap-2">
        <span className="size-3 rounded-sm bg-mint/40" /> Life: meals, cooking and gym from your plans, moved around
        study when they clash
      </p>
      <p className="flex items-center gap-2">
        <span className="size-3 rounded-sm bg-sand/25 ring-2 ring-coral" /> Life item with nowhere to move to
      </p>
      <p className="flex items-center gap-2">
        <span className="size-3 rounded-sm bg-white/10 ring-1 ring-white/20" /> Other calendar events (read-only)
      </p>
    </div>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-primary/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md card p-6">
        <div className="mb-2 flex justify-end">
          <button
            className="cursor-pointer text-sm text-neutral-400 hover:text-white"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TimeFields({
  days,
  date,
  setDate,
  start,
  setStart,
  duration,
  setDuration,
}: {
  days: string[];
  date: string;
  setDate: (v: string) => void;
  start: number;
  setStart: (v: number) => void;
  duration: number;
  setDuration: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <label className="block">
        <span className="field-label">Day</span>
        <select className="field-input" value={date} onChange={(e) => setDate(e.target.value)}>
          {days.map((d, i) => (
            <option key={d} value={d}>
              {WEEKDAY[i]} {shortDate(d)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="field-label">Start</span>
        <input
          type="time"
          step={900}
          className="field-input"
          value={clock(start)}
          onChange={(e) => {
            const m = parseClock(e.target.value);
            if (m !== null) setStart(m);
          }}
        />
      </label>
      <label className="block">
        <span className="field-label">Length</span>
        <select className="field-input" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {(DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b)).map((m) => (
            <option key={m} value={m}>
              {m < 60 ? `${m} min` : `${m / 60} h`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function NewBlockForm({
  dialog,
  days,
  unscheduled,
  googleReady,
  pending,
  onSubmitLife,
  onSubmitWork,
}: {
  dialog: Extract<Dialog, { mode: "new" }>;
  days: string[];
  unscheduled: Unscheduled[];
  googleReady: boolean;
  pending: boolean;
  onSubmitLife: (input: {
    kind: string;
    title: string;
    date: string;
    start: number;
    duration: number;
    repeat: string;
  }) => void;
  onSubmitWork: (input: { gid: string; date: string; start: number; duration: number }) => void;
}) {
  const [tab, setTab] = useState(dialog.tab);
  const [date, setDate] = useState(dialog.date);
  const [start, setStart] = useState(dialog.start);
  const [duration, setDuration] = useState(60);
  const [kind, setKind] = useState<LifeKind>("lunch");
  const [title, setTitle] = useState("");
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [gid, setGid] = useState(dialog.gid ?? unscheduled[0]?.gid ?? "");

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {(["work", "life"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`btn px-4 py-1.5 ring-1 ${tab === t ? "bg-lavender text-white ring-lavender" : "bg-white/5 text-neutral-300 ring-white/10"}`}
          >
            {t === "work" ? "Task" : "Life block"}
          </button>
        ))}
      </div>

      {tab === "life" && !googleReady ? (
        <p className="text-sm text-neutral-300">
          Life blocks are saved in Google Calendar.{" "}
          <a href="/api/google/connect" className="text-aqua hover:underline">
            Connect Google Calendar
          </a>{" "}
          to add them.
        </p>
      ) : tab === "life" ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitLife({ kind, title, date, start, duration, repeat });
          }}
        >
          <div className="flex flex-wrap gap-2">
            {(Object.keys(LIFE_KINDS) as LifeKind[]).map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => setKind(k)}
                className={`chip px-3 py-1 text-sm ${kind === k ? LIFE_KINDS[k].className : "bg-white/5 text-neutral-400 ring-white/10"}`}
              >
                {LIFE_KINDS[k].label}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="field-label">Title</span>
            <input
              className="field-input"
              value={title}
              maxLength={120}
              placeholder={LIFE_KINDS[kind].label}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <TimeFields {...{ days, date, setDate, start, setStart, duration, setDuration }} />
          <label className="block">
            <span className="field-label">Repeat</span>
            <select className="field-input" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              {(Object.keys(REPEATS) as Repeat[]).map((r) => (
                <option key={r} value={r}>
                  {REPEATS[r]}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary w-full" disabled={pending} aria-busy={pending}>
            Add to Google Calendar
          </button>
        </form>
      ) : unscheduled.length === 0 ? (
        <p className="text-sm text-neutral-400">Every open task already has a time. Drag a block to move it.</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitWork({ gid, date, start, duration });
          }}
        >
          <label className="block">
            <span className="field-label">Task</span>
            <select className="field-input" value={gid} onChange={(e) => setGid(e.target.value)}>
              {unscheduled.map((t) => (
                <option key={t.gid} value={t.gid}>
                  {t.project}: {t.title}
                </option>
              ))}
            </select>
          </label>
          <TimeFields {...{ days, date, setDate, start, setStart, duration, setDuration }} />
          <p className="text-xs text-neutral-400">Sets the task&apos;s start and due time.</p>
          <button className="btn-primary w-full" disabled={pending || !gid} aria-busy={pending}>
            Plan it
          </button>
        </form>
      )}
    </div>
  );
}

function EditBlockForm({
  block,
  days,
  pending,
  googleReady,
  onMove,
  onUnschedule,
  onDelete,
  onAddSession,
}: {
  block: Block;
  days: string[];
  pending: boolean;
  googleReady: boolean;
  onMove: (date: string, start: number, duration: number) => void;
  onUnschedule: () => void;
  onDelete: (wholeSeries: boolean) => void;
  onAddSession: (date: string, start: number, duration: number) => void;
}) {
  const [date, setDate] = useState(block.date);
  const [start, setStart] = useState(block.start);
  const [duration, setDuration] = useState(block.end - block.start);
  const isWork = isStudy(block);
  const isSession = block.source === "session";
  const taskGid = block.taskGid ?? rawId(block);

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">
          {isWork
            ? `${block.project ?? "Study"}${isSession ? " · session" : ""}`
            : block.kind
              ? LIFE_KINDS[block.kind as LifeKind]?.label
              : block.invite
                ? `Google Calendar · ${INVITE_LABEL[block.invite]}`
                : "Google Calendar"}
        </p>
        <h2 className="text-xl font-semibold">{block.title}</h2>
        <p className="text-sm text-neutral-400">
          {clock(block.start)}–{clock(block.end)}
          {block.stage ? ` · ${block.stage}` : ""}
        </p>
      </div>

      {block.editable ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onMove(date, start, duration);
          }}
        >
          <TimeFields {...{ days, date, setDate, start, setStart, duration, setDuration }} />
          {block.seriesId && <p className="text-xs text-neutral-400">Changes this occurrence only.</p>}
          <button className="btn-primary w-full" disabled={pending} aria-busy={pending}>
            Save
          </button>
        </form>
      ) : (
        <p className="text-sm text-neutral-400">
          {isWork ? "This task is finished." : "This event wasn't made in the portal, so edit it in Google Calendar."}
        </p>
      )}

      {isWork && block.editable && googleReady && (
        <AddSessionForm block={block} days={days} pending={pending} onAdd={onAddSession} />
      )}

      <div className="flex flex-wrap gap-2">
        {isWork && !block.completed && (
          <Link href={`/log?task=${taskGid}`} className="btn-ghost">
            Log session
          </Link>
        )}
        {block.source === "asana" && block.editable && (
          <button className="btn-ghost" disabled={pending} aria-busy={pending} onClick={onUnschedule}>
            Remove time
          </button>
        )}
        {isSession && block.editable && (
          <button
            className="btn-ghost text-coral"
            disabled={pending}
            aria-busy={pending}
            onClick={() => onDelete(false)}
          >
            Delete this session
          </button>
        )}
        {block.source === "google" && block.editable && (
          <>
            <button
              className="btn-ghost text-coral"
              disabled={pending}
              aria-busy={pending}
              onClick={() => onDelete(false)}
            >
              {block.seriesId ? "Delete this one" : "Delete"}
            </button>
            {block.seriesId && (
              <button
                className="btn-ghost text-coral"
                disabled={pending}
                aria-busy={pending}
                onClick={() => onDelete(true)}
              >
                Delete all repeats
              </button>
            )}
          </>
        )}
        <TaskLink href={block.url} className="btn-ghost">
          {isWork ? "Open task" : "Open in Google"}
        </TaskLink>
      </div>
    </div>
  );
}

/** A Life plan item: where it comes from and why it sits where it does. Changed in Life, not here. */
function PlanBlockInfo({ block }: { block: Block }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">From your Life plan</p>
        <h2 className="text-xl font-semibold">{block.title}</h2>
        <p className="text-sm text-neutral-400">
          {shortDate(block.date)} · {clock(block.start)}–{clock(block.end)}
        </p>
      </div>
      {block.note && (
        <p
          className={`rounded-xl p-3 text-sm ${block.clash ? "bg-coral/10 text-coral" : "bg-white/5 text-neutral-300"}`}
        >
          {block.note}.{block.clash ? " Move the other event, or change the plan in Life." : ""}
        </p>
      )}
      <p className="text-sm text-neutral-400">
        This follows your meal plan and gym days. When study or an event takes its time, it moves to the nearest free
        time that still works (lunch stays at lunchtime, the shake after the gym). Change the plan in Life and it moves
        here and in Google Calendar.
      </p>
      <Link href={block.url} className="btn-primary w-full">
        Open in Life
      </Link>
    </div>
  );
}

const INVITE_LABEL = {
  accepted: "going",
  tentative: "maybe",
  needsAction: "not answered",
  declined: "declined",
} as const;

/** Another block of time on the same task, the next day at the same time by default. */
function AddSessionForm({
  block,
  days,
  pending,
  onAdd,
}: {
  block: Block;
  days: string[];
  pending: boolean;
  onAdd: (date: string, start: number, duration: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const next = days[days.indexOf(block.date) + 1] ?? block.date;
  const [date, setDate] = useState(next);
  const [start, setStart] = useState(block.start);
  const [duration, setDuration] = useState(block.end - block.start);
  if (!open) {
    return (
      <button className="btn-ghost w-full" disabled={pending} aria-busy={pending} onClick={() => setOpen(true)}>
        Add another session on this task
      </button>
    );
  }
  return (
    <form
      className="space-y-3 rounded-xl bg-white/5 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(date, start, duration);
      }}
    >
      <p className="text-sm font-semibold">Another session</p>
      <TimeFields {...{ days, date, setDate, start, setStart, duration, setDuration }} />
      <p className="text-xs text-neutral-400">
        Sessions go to Google Calendar. The task stays due when its own block ends.
      </p>
      <button className="btn-primary w-full" disabled={pending} aria-busy={pending}>
        Add session
      </button>
    </form>
  );
}
