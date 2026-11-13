// The roadmap as a mentor sees it: only the plans shared with them, with phase
// progress counted over those plans alone, plus when the work is due and whether it
// is on time. Pure, so the same view can be checked in tests.

import type { ReviewRow } from "../tasks/model.ts";
import type { Roadmap, RoadmapUnit } from "./load.ts";
import { findUnit } from "./plans.ts";

export type SharedUnit = RoadmapUnit & { dueOn: string | null; overdue: boolean };

export type SharedPhase = {
  index: number;
  name: string;
  why: string;
  exit: string;
  state: "done" | "now" | "later";
  tracks: { project: string; title: string; units: SharedUnit[] }[];
  links: { aShort: string; bShort: string; why: string }[];
  done: number;
  total: number;
  hoursLeft: number;
};

export type SharedRoadmap = {
  phases: SharedPhase[];
  current: SharedPhase | null;
  done: number;
  total: number;
  hoursLeft: number;
  overdue: SharedUnit[];
  /** The last due date on the main path, when every unit still to do has one. */
  finishOn: string | null;
  undated: number;
};

export function shareRoadmap(
  roadmap: Roadmap,
  input: { projects: readonly string[]; dueOn: ReadonlyMap<string, string | null>; today: string },
): SharedRoadmap {
  const visible = new Set(input.projects);
  const projectOf = (ref: string) => findUnit(ref)?.plan.project;

  const shaped = roadmap.phases.flatMap((phase) => {
    const tracks = phase.tracks
      .filter((t) => visible.has(t.project))
      .map((t) => ({
        project: t.project,
        title: t.title,
        units: t.units.map((u) => {
          const dueOn = input.dueOn.get(u.ref) ?? null;
          return { ...u, dueOn, overdue: !u.done && !u.optional && Boolean(dueOn && dueOn < input.today) };
        }),
      }));
    const core = tracks.flatMap((t) => t.units).filter((u) => !u.optional);
    if (!core.length) return [];
    return [
      {
        index: phase.index,
        name: phase.phase.name,
        why: phase.phase.why,
        exit: phase.phase.exit,
        tracks,
        // A link is only shown when the mentor can see both of its ends.
        links: phase.links
          .filter((l) => visible.has(projectOf(l.a) ?? "") && visible.has(projectOf(l.b) ?? ""))
          .map((l) => ({ aShort: l.aShort, bShort: l.bShort, why: l.why })),
        done: core.filter((u) => u.done).length,
        total: core.length,
        hoursLeft: core.filter((u) => !u.done).reduce((sum, u) => sum + u.hours, 0),
      },
    ];
  });

  const nowIndex = shaped.findIndex((p) => p.done < p.total);
  const phases: SharedPhase[] = shaped.map((p, i) => ({
    ...p,
    state: p.done === p.total ? "done" : i === nowIndex ? "now" : "later",
  }));
  const remaining = phases.flatMap((p) => p.tracks.flatMap((t) => t.units)).filter((u) => !u.optional && !u.done);
  const dates = remaining.map((u) => u.dueOn);

  return {
    phases,
    current: phases.find((p) => p.state === "now") ?? null,
    done: phases.reduce((sum, p) => sum + p.done, 0),
    total: phases.reduce((sum, p) => sum + p.total, 0),
    hoursLeft: phases.reduce((sum, p) => sum + p.hoursLeft, 0),
    overdue: remaining.filter((u) => u.overdue),
    finishOn: dates.length && dates.every(Boolean) ? (dates as string[]).sort().at(-1)! : null,
    undated: dates.filter((d) => !d).length,
  };
}

const DAY_MS = 86400000;

/** How recall practice has gone over the last two weeks. */
export function recallSummary(
  reviews: readonly Pick<ReviewRow, "last_rating" | "last_reviewed_at">[],
  today: string,
  days = 14,
) {
  const since = Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS;
  const recent = reviews.filter((r) => r.last_reviewed_at && Date.parse(r.last_reviewed_at) >= since);
  const count = (rating: string) => recent.filter((r) => r.last_rating === rating).length;
  return { days, reviewed: recent.length, got: count("got"), shaky: count("shaky"), missed: count("missed") };
}
