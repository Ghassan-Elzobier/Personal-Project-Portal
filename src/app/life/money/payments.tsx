"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import { Fold } from "@/components/ui";
import { addDays, shortDate } from "@/lib/dates/week";
import { mondayOf } from "@/lib/money/budget";
import { byWeek, KIND_NAMES, pounds, txnName, type Category, type CategoryKind, type Txn } from "@/lib/money/state";
import { Sheet } from "../kit";
import { setCategory } from "./actions";

const METHOD: Record<string, string> = {
  card: "Card",
  "direct-debit": "Direct Debit",
  "standing-order": "Standing order",
  transfer: "Transfer",
  cash: "Cash",
};

function dayName(day: string, today: string): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00Z`);
  if (Math.round((new Date(`${today}T12:00:00Z`).getTime() - d.getTime()) / 86_400_000) === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** "This week", "Last week", then "9–15 Nov" (or "26 Oct – 1 Nov" across a month). */
function weekName(monday: string, today: string): string {
  const thisWeek = mondayOf(today);
  if (monday === thisWeek) return "This week";
  if (monday === addDays(thisWeek, -7)) return "Last week";
  const [from, to] = [shortDate(monday), shortDate(addDays(monday, 6))];
  const [fromDay, fromMonth] = from.split(" ");
  return fromMonth === to.split(" ")[1] ? `${fromDay}–${to}` : `${from} – ${to}`;
}

/**
 * The payments by money week, then by day. This week, last week and the newest week
 * with something to sort start open, and a week stays open once a payment in it is
 * tapped; each week's header says what went out, came in and is still to sort. Tapping
 * one opens its categories; the choice shows at once, and "Always" makes it a rule for that merchant, which sorts its other payments too.
 */
export function PaymentList({ txns, categories, today }: { txns: Txn[]; categories: Category[]; today: string }) {
  const [open, setOpen] = useState<Txn | null>(null);
  const [always, setAlways] = useState(true);
  // Weeks the owner has sorted in stay open, even once nothing in them is left to sort.
  const [worked, setWorked] = useState<string[]>([]);
  const [, start] = useTransition();
  const [sorted, setSorted] = useOptimistic(
    Object.fromEntries(txns.map((t) => [t.id, t.categoryId])) as Record<number, number | null>,
    (current, change: { id: number; category: number | null }) => ({ ...current, [change.id]: change.category }),
  );
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const kinds = [...new Set(categories.map((c) => c.kind))] as CategoryKind[];

  const pick = (t: Txn, category: number | null) => {
    setOpen(null);
    start(async () => {
      setSorted({ id: t.id, category });
      const r = await setCategory(t.id, category, always && category !== null);
      if (r.error) toast(r.error, { tone: "error" });
    });
  };

  const weeks = byWeek(txns, today);
  const toSortIn = (w: (typeof weeks)[number]) =>
    w.days.reduce((n, d) => n + d.txns.filter((t) => !sorted[t.id]).length, 0);
  // The newest week with something still to sort is open too, so the next one is a tap away.
  const nextToSort = weeks.find((w) => toSortIn(w) > 0)?.monday;

  return (
    <>
      <div className="space-y-2">
        {weeks.map((w) => {
          const toSort = toSortIn(w);
          return (
            <Fold
              key={w.monday}
              open={w.monday >= addDays(mondayOf(today), -7) || w.monday === nextToSort || worked.includes(w.monday)}
              title={<span className="font-medium text-body">{weekName(w.monday, today)}</span>}
              meta={[`${pounds(w.out)} out`, `${pounds(w.in)} in`, toSort > 0 ? `${toSort} to sort` : null]
                .filter(Boolean)
                .join(" · ")}
            >
              <div className="space-y-4 pt-1 pb-2">
                {w.days.map((d) => (
                  <div key={d.day ?? "pending"} className="space-y-1">
                    <p className="flex justify-between gap-3 eyebrow">
                      <span>{d.day ? dayName(d.day, today) : "Pending"}</span>
                      {d.out > 0 && <span className="tabular-nums">{pounds(-d.out)}</span>}
                    </p>
                    <ul className="divide-y divide-white/5 rounded-xl bg-white/5">
                      {d.txns.map((t) => {
                        const cat = sorted[t.id];
                        return (
                          <li key={t.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setAlways(true);
                                setOpen(t);
                                setWorked((ws) => (ws.includes(w.monday) ? ws : [...ws, w.monday]));
                              }}
                              className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-white/5"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm">{txnName(t)}</span>
                                <span className="block truncate text-xs text-muted">
                                  {[
                                    cat ? nameOf.get(cat) : "Not sorted",
                                    t.status === "pending" ? "Pending" : METHOD[t.method],
                                    t.source === "statement" ? "From a statement" : null,
                                    t.note,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </span>
                              <span
                                className={`shrink-0 text-sm tabular-nums ${t.pence > 0 ? "text-mint" : "text-bright"}`}
                              >
                                {t.pence > 0 ? `+${pounds(t.pence)}` : pounds(t.pence)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </Fold>
          );
        })}
      </div>
      <Sheet open={open !== null} onClose={() => setOpen(null)} title="What was this for?">
        {open && (
          <div className="space-y-4">
            <p className="flex justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-body">{txnName(open)}</span>
              <span className="shrink-0 tabular-nums">{pounds(open.pence)}</span>
            </p>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-mint"
                checked={always}
                onChange={() => setAlways((a) => !a)}
              />
              Always for this merchant
            </label>
            {kinds.map((k) => (
              <div key={k} className="space-y-2">
                <p className="eyebrow">{KIND_NAMES[k]}</p>
                <div className="flex flex-wrap gap-2">
                  {categories
                    .filter((c) => c.kind === k)
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={sorted[open.id] === c.id}
                        onClick={() => pick(open, c.id)}
                        className={`tap rounded-full px-3 text-sm ring-1 ${sorted[open.id] === c.id ? "bg-mint/15 text-mint ring-mint/40" : "bg-white/5 ring-white/10 hover:bg-white/10"}`}
                      >
                        {c.name}
                      </button>
                    ))}
                </div>
              </div>
            ))}
            {sorted[open.id] !== null && (
              <button type="button" onClick={() => pick(open, null)} className="text-sm text-muted underline">
                Leave it to the rules
              </button>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
