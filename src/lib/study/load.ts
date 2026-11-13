import "server-only";
import { allTasks, attempt, today, type TaskView } from "../portal/data";
import { PROJECTS, projectDef, type ProjectKey } from "../config/projects";
import { listSections, studySnapshot, type StudySnapshot } from "../tasks/native";
import { groupBenchmarks } from "./benchmarks";
import { linksFor, type PlanLink } from "./links";
import { viewsForUnit } from "../lab/guide";
import { bookHref } from "../library/links";
import { dependents, findUnit, PLANS } from "./plans";
import { planUnits, unitHours, type PlanUnit, type StudyPlan } from "./plan-types";
import { tallyExercises, type ExerciseTally } from "./review";
import { linksAt, PHASES, type Phase } from "./roadmap";

// Shapes the study plans and their progress for the Study page, Progress page
// and Claude's connector. Everything comes from two cached reads, so asking for
// several plans costs no more than asking for one.

export type UnitLink = { short: string; href: string; done: boolean };
export type UnitConnection = UnitLink & { why: string };

export type UnitRow = {
  unit: PlanUnit;
  task: TaskView;
  tally: ExerciseTally;
  stepsDone: number;
  stepsTotal: number;
  needs: UnitLink[];
  /** Units that build on this one and have no link of their own to explain why. */
  feeds: UnitLink[];
  /** Where this meets the other plans, and why. */
  connections: UnitConnection[];
};

export type PlanProgress = {
  plan: StudyPlan;
  loaded: boolean;
  missing: number;
  rows: UnitRow[];
  /** Units not in the optional set, which is what pacing and percent complete count. */
  core: { total: number; done: number };
  exercises: { total: number; solved: number; stuck: number };
  hours: number;
  next: UnitRow | null;
  /** Tasks in the project that did not come from the plan. */
  others: number;
};

type Loaded = { tasks: Map<ProjectKey, TaskView[]>; study: StudySnapshot };

async function loadAll(): Promise<Loaded> {
  const study = await studySnapshot();
  const perProject = await Promise.all(
    PROJECTS.map(async (p) => {
      const result = await attempt(() => allTasks(p.key));
      return [p.key, result.ok ? result.value : []] as const;
    }),
  );
  return { tasks: new Map(perProject), study };
}

function buildProgress(plan: StudyPlan, { tasks, study }: Loaded): PlanProgress {
  const list = tasks.get(plan.project) ?? [];
  const everyTask = [...tasks.values()].flat();
  const byRef = new Map(everyTask.filter((t) => t.ref).map((t) => [t.ref as string, t]));

  const link = (ref: string): UnitLink | null => {
    const found = findUnit(ref);
    const task = byRef.get(ref);
    if (!found) return null;
    return {
      short: found.unit.short,
      href: task ? `/study?project=${found.plan.project}&task=${task.gid}` : `/study?project=${found.plan.project}`,
      done: task?.completed ?? false,
    };
  };

  const rows: UnitRow[] = planUnits(plan).flatMap((unit) => {
    const task = byRef.get(unit.ref);
    if (!task || task.project !== plan.project) return [];
    const steps = study.subtasks.filter((s) => s.task_gid === task.gid);
    const linked = linksFor(unit.ref);
    return [
      {
        unit,
        task,
        tally: tallyExercises(study.exercises.filter((e) => e.task_gid === task.gid).map((e) => e.status)),
        stepsDone: steps.filter((s) => s.done).length,
        stepsTotal: steps.length,
        needs: (unit.needs ?? []).flatMap((r) => link(r) ?? []),
        feeds: dependents(unit.ref)
          .filter((d) => !linked.some((l) => l.ref === d.unit.ref))
          .flatMap((d) => link(d.unit.ref) ?? []),
        connections: linked.flatMap((l) => {
          const to = link(l.ref);
          return to ? [{ ...to, why: l.why }] : [];
        }),
      },
    ];
  });

  const core = rows.filter((r) => !r.unit.optional);
  const units = planUnits(plan);
  return {
    plan,
    loaded: rows.length > 0,
    missing: units.length - rows.length,
    rows,
    core: { total: core.length, done: core.filter((r) => r.task.completed).length },
    exercises: {
      total: rows.reduce((sum, r) => sum + (r.task.exerciseCount ?? 0), 0),
      solved: rows.reduce((sum, r) => sum + r.tally.solved, 0),
      stuck: rows.reduce((sum, r) => sum + r.tally.stuck, 0),
    },
    hours: Math.round(rows.reduce((sum, r) => sum + r.task.hours, 0) * 100) / 100,
    // Keep working on what is under way before starting the next thing.
    next:
      core.find((r) => !r.task.completed && r.task.stage === "In progress") ??
      core.find((r) => !r.task.completed) ??
      null,
    others: list.filter((t) => !t.ref).length,
  };
}

export type RoadmapUnit = {
  ref: string;
  name: string;
  short: string;
  href: string | null;
  done: boolean;
  optional: boolean;
  hours: number;
};

export type RoadmapPhase = {
  phase: Phase;
  index: number;
  state: "done" | "now" | "later";
  /** The three plans side by side, in the order they appear on the page. */
  tracks: { project: ProjectKey; title: string; units: RoadmapUnit[] }[];
  links: (PlanLink & { aShort: string; bShort: string })[];
  done: number;
  total: number;
  hoursLeft: number;
};

export type Roadmap = {
  phases: RoadmapPhase[];
  current: RoadmapPhase | null;
  /** Units in the plans that have not been added to the database. */
  missing: number;
  hoursLeft: number;
  /** How many units on the main path still to do already have a date. */
  dated: number;
  remaining: number;
};

/** The roadmap's phases with each plan's progress filled in. */
export function buildRoadmap(plans: PlanProgress[]): Roadmap {
  const rows = new Map(plans.flatMap((p) => p.rows.map((r) => [r.unit.ref, r] as const)));
  const short = (ref: string) => findUnit(ref)?.unit.short ?? ref;

  const shaped = PHASES.map((phase, index) => {
    const tracks = PLANS.map((plan) => ({
      project: plan.project,
      title: projectDef(plan.project).title,
      units: phase.units.flatMap((ref): RoadmapUnit[] => {
        const found = findUnit(ref);
        if (found?.plan !== plan) return [];
        const row = rows.get(ref);
        return [
          {
            ref,
            name: row?.task.name ?? found.unit.name,
            short: found.unit.short,
            href: row ? `/study?task=${row.task.gid}` : null,
            done: row?.task.completed ?? false,
            optional: found.unit.optional ?? false,
            hours: unitHours(found.unit, plan),
          },
        ];
      }),
    }));
    const core = tracks.flatMap((t) => t.units).filter((u) => !u.optional);
    return {
      phase,
      index,
      tracks,
      links: linksAt(index).map((l) => ({ ...l, aShort: short(l.a), bShort: short(l.b) })),
      done: core.filter((u) => u.done).length,
      total: core.length,
      hoursLeft: core.filter((u) => !u.done).reduce((sum, u) => sum + u.hours, 0),
    };
  });

  const nowIndex = shaped.findIndex((p) => p.done < p.total);
  const phases: RoadmapPhase[] = shaped.map((p) => ({
    ...p,
    state: p.done === p.total ? "done" : p.index === nowIndex ? "now" : "later",
  }));
  const open = plans.flatMap((p) => p.rows).filter((r) => !r.unit.optional && !r.task.completed);

  return {
    phases,
    current: phases.find((p) => p.state === "now") ?? null,
    missing: plans.reduce((sum, p) => sum + p.missing, 0),
    hoursLeft: phases.reduce((sum, p) => sum + p.hoursLeft, 0),
    dated: open.filter((r) => r.task.dueOn).length,
    remaining: open.length,
  };
}

export type ReviewItem = {
  gid: string;
  prompt: string;
  kind: string;
  step: number;
  dueOn: string;
  source: string;
  sourceHref: string;
  bookHref: string | null;
};

export type StudyOverview = {
  today: string;
  plans: PlanProgress[];
  roadmap: Roadmap;
  due: ReviewItem[];
  upcoming: number;
  study: StudySnapshot;
  sections: (project: ProjectKey) => { gid: string; name: string }[];
};

/** Every plan's progress, plus the reviews due across all of them. */
export async function loadStudy(): Promise<StudyOverview> {
  const loaded = await loadAll();
  const date = today();
  const plans = PLANS.map((p) => buildProgress(p, loaded));
  const everyTask = [...loaded.tasks.values()].flat();
  const taskByGid = new Map(everyTask.map((t) => [t.gid, t]));

  const due: ReviewItem[] = loaded.study.reviews.flatMap((r) => {
    const task = taskByGid.get(r.task_gid);
    if (!task || !r.due_on || r.due_on > date) return [];
    const found = findUnit(task.ref);
    return [
      {
        gid: r.gid,
        prompt: r.prompt,
        kind: r.kind,
        step: r.step,
        dueOn: r.due_on,
        source: found?.unit.short ?? task.name,
        sourceHref: `/study?project=${task.project}&task=${task.gid}`,
        bookHref: found?.plan.sourceUrl && found.unit.page ? found.plan.sourceUrl(found.unit.page) : null,
      },
    ];
  });
  const upcoming = loaded.study.reviews.filter((r) => r.due_on && r.due_on > date).length;
  const sectionLists = new Map(
    await Promise.all(
      PROJECTS.map(async (p) => {
        const result = await attempt(() => listSections(p.key));
        return [p.key, result.ok ? result.value : []] as const;
      }),
    ),
  );
  return {
    today: date,
    plans,
    roadmap: buildRoadmap(plans),
    due,
    upcoming,
    study: loaded.study,
    sections: (project) => sectionLists.get(project) ?? [],
  };
}

/** The same thing in a compact form for Claude. */
export async function studyOverview() {
  const { today: date, plans, roadmap, due, upcoming, study } = await loadStudy();
  const now = roadmap.current;
  return {
    today: date,
    roadmap: now && {
      phase: `${now.index + 1} of ${roadmap.phases.length}: ${now.phase.name}`,
      why: now.phase.why,
      done_when: now.phase.exit,
      still_to_do: now.tracks.flatMap((t) =>
        t.units.filter((u) => !u.done && !u.optional).map((u) => ({ plan: t.title, unit: u.name })),
      ),
      connections: now.links.map((l) => ({ between: [l.aShort, l.bShort], why: l.why })),
      estimated_hours_left_overall: roadmap.hoursLeft,
    },
    plans: plans.map((p) => ({
      project: p.plan.project,
      title: projectDef(p.plan.project).title,
      loaded: p.loaded,
      done: `${p.core.done} of ${p.core.total} ${p.plan.unitLabel}, not counting optional ones`,
      exercises: p.exercises,
      hours: p.hours,
      next: p.next && {
        task_gid: p.next.task.gid,
        name: p.next.task.name,
        notes: p.next.task.notes,
        steps_done: `${p.next.stepsDone} of ${p.next.stepsTotal}`,
        due_on: p.next.task.dueOn,
        needs_unfinished: p.next.needs.filter((n) => !n.done).map((n) => n.short),
        connections: p.next.connections.map((c) => ({ with: c.short, why: c.why })),
        open_at: p.plan.sourceUrl && p.next.unit.page ? p.plan.sourceUrl(p.next.unit.page) : undefined,
        local_pdf_page: !p.plan.sourceUrl && p.next.unit.page ? p.next.unit.page : undefined,
      },
      stuck: p.rows.flatMap((r) =>
        study.exercises
          .filter((e) => e.task_gid === r.task.gid && e.status === "stuck")
          .map((e) => ({ task_gid: r.task.gid, section: r.task.name, exercise: e.number })),
      ),
    })),
    reviews_due: due.map((r) => ({ review_gid: r.gid, prompt: r.prompt, source: r.source })),
    reviews_later: upcoming,
    benchmarks: groupBenchmarks(study.benchmarks).map((b) => ({
      metric: b.metric,
      scene: b.scene,
      gpu: b.gpu,
      unit: b.unit,
      latest: Number(b.latest.value),
      change_percent: b.changePercent,
      commit: b.latest.commit_sha,
    })),
  };
}

/** What the task panel shows for a unit, or for any other task with steps. */
export function panelFor(row: Pick<UnitRow, "task"> & Partial<UnitRow>, study: StudySnapshot) {
  const { task } = row;
  const found = findUnit(task.ref);
  const links: { label: string; href: string }[] = [];
  if (found?.plan.sourceUrl && found.unit.page)
    links.push({ label: `Open at page ${found.unit.page}`, href: found.plan.sourceUrl(found.unit.page) });
  if (found?.plan.mode === "lab" && found.plan.sourceUrl)
    links.push({ label: "Open the repo", href: found.plan.sourceUrl() });
  for (const l of found?.plan.extraLinks ?? []) links.push({ label: l.label, href: l.url });
  for (const l of found?.unit.links ?? []) links.push({ label: l.label, href: l.url });
  // A book kept as a private PDF opens in the portal's own reader.
  if (found && !found.plan.sourceUrl && found.unit.page) {
    links.unshift(
      { label: `Read p. ${found.unit.page} here`, href: bookHref.page(found.unit.page) },
      { label: "Open the PDF", href: bookHref.pdf(found.unit.page) },
    );
  }
  for (const v of viewsForUnit(task.ref ?? "")) links.push({ label: `Lab: ${v.title}`, href: `/lab/${v.id}` });
  return {
    taskGid: task.gid,
    mode: found?.plan.mode ?? null,
    completed: task.completed,
    exerciseCount: task.exerciseCount,
    exercises: Object.fromEntries(
      study.exercises.filter((e) => e.task_gid === task.gid).map((e) => [e.number, e.status]),
    ),
    steps: study.subtasks
      .filter((s) => s.task_gid === task.gid)
      .map((s) => ({ gid: s.gid, name: s.name, done: s.done })),
    reviews: study.reviews
      .filter((r) => r.task_gid === task.gid)
      .map((r) => ({ gid: r.gid, prompt: r.prompt, dueOn: r.due_on })),
    links,
    pdfPage: found && !found.plan.sourceUrl ? (found.unit.page ?? null) : null,
    needs: row.needs ?? [],
    feeds: row.feeds ?? [],
    connections: row.connections ?? [],
  };
}
