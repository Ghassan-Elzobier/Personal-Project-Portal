import "server-only";
import { describe, summarize, type SessionStats } from "./stats";
import * as store from "./store";
import { parsePlan, type Plan } from "./plan";
import { loadStudy } from "../study/load";

// What the tutor pages show: sessions with the unit each was on, and one session
// in full. Reads only; every change goes through operations.ts.

export type SessionCard = {
  gid: string;
  kind: store.SessionKind;
  status: store.SessionRow["status"];
  goal: string;
  unit: string | null;
  date: string;
  result: string | null;
  summary: string;
};

async function unitNames(): Promise<Map<string, string>> {
  const rows = (await loadStudy()).plans.flatMap((p) => p.rows);
  return new Map(rows.map((r) => [r.task.gid, r.unit.short]));
}

export async function loadSessions(): Promise<SessionCard[]> {
  const [graph, units] = await Promise.all([store.readGraph(null), unitNames()]);
  return graph.sessions.map((s) => ({
    gid: s.gid,
    kind: s.kind,
    status: s.status,
    goal: s.goal,
    unit: s.task_gid ? (units.get(s.task_gid) ?? null) : null,
    date: s.created_at.slice(0, 10),
    result: describe({ checked: s.checked, correct: s.correct, confidentMisses: s.confident_misses }),
    summary: s.summary,
  }));
}

export type SessionView = {
  card: SessionCard;
  plan: Plan | null;
  stats: SessionStats;
  answers: store.AnswerRow[];
  claims: store.ClaimRow[];
};

export async function loadSession(gid: string): Promise<SessionView> {
  const [record, units] = await Promise.all([store.readSession(gid), unitNames()]);
  const s = record.session;
  const stats = summarize(
    record.answers.map((a) => ({ correct: a.correct, confidence: a.confidence, dontKnow: a.dont_know })),
  );
  const parsed = s.plan ? parsePlan(s.plan) : null;
  return {
    card: {
      gid: s.gid,
      kind: s.kind,
      status: s.status,
      goal: s.goal,
      unit: s.task_gid ? (units.get(s.task_gid) ?? null) : null,
      date: s.created_at.slice(0, 10),
      result: describe(stats),
      summary: s.summary,
    },
    plan: parsed && "plan" in parsed ? parsed.plan : null,
    stats,
    answers: record.answers,
    claims: record.claims,
  };
}

/** Recent sessions on one unit, for its panel. */
export async function loadUnitSessions(
  taskGid: string,
): Promise<{ gid: string; kind: string; goal: string; date: string }[]> {
  const graph = await store.readGraph([taskGid]);
  return graph.sessions
    .slice(0, 5)
    .map((s) => ({ gid: s.gid, kind: s.kind, goal: s.goal, date: s.created_at.slice(0, 10) }));
}
