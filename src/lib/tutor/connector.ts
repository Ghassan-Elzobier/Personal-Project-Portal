import "server-only";
import { loadStudy } from "../study/load";
import { err, ok, type Json, type Tool, type ToolResult } from "../mcp/tool";
import { searchClaims, unitScope } from "./graph";
import { PRACTICE_METHOD, TEACH_METHOD } from "./method";
import * as ops from "./operations";
import { describe, summarize } from "./stats";
import * as store from "./store";

// The tutor for the Claude connector: Claude teaches in the Claude app and these
// tools hold the record. Writes go through the same operations an in-portal tutor
// page will use. Everything saved is the owner's own wording, never book text.

const SESSION = { type: "string", pattern: "^\\d+$", description: "Session number from tutor_start." };
const TASK = { type: "string", pattern: "^\\d+$", description: "Task gid of the study unit, from get_study." };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

async function guarded(read: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof store.TutorError) return err(e.message);
    throw e;
  }
}

export const TUTOR_TOOLS: Tool[] = [
  {
    name: "tutor_start",
    title: "Start a tutoring session",
    description:
      "Begin a teach or practice session, optionally on a study unit. Returns the session number, the method to follow, the unit, the claims the owner already holds nearby, and how earlier sessions on it went. Call this before teaching.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { enum: ["teach", "practice"] },
        goal: {
          type: "string",
          maxLength: 500,
          description: "What the owner wants to understand or practise, in their words.",
        },
        task_gid: TASK,
      },
      required: ["kind", "goal"],
      additionalProperties: false,
    },
    annotations: WRITE,
    async run(args) {
      return guarded(async () => {
        const started = await ops.startSession(args);
        if (started.error !== undefined) return err(started.error);
        const taskGid = typeof args.task_gid === "string" ? args.task_gid : null;
        let unit: Json | null = null;
        let scope: string[] | null = null;
        if (taskGid) {
          const rows = (await loadStudy()).plans.flatMap((p) => p.rows);
          const row = rows.find((r) => r.task.gid === taskGid);
          scope = unitScope(rows, taskGid);
          if (row)
            unit = {
              name: row.unit.name,
              short: row.unit.short,
              book_page: row.unit.page ?? null,
              steps: row.unit.steps,
              needs: row.needs.map((n) => ({ short: n.short, done: n.done })),
            };
        }
        const graph = await store.readGraph(scope);
        const history = graph.sessions
          .filter((s) => s.status !== "open" && (!taskGid || s.task_gid === taskGid))
          .slice(0, 5)
          .map((s) => ({
            kind: s.kind,
            date: s.created_at.slice(0, 10),
            goal: s.goal,
            result: describe({ checked: s.checked, correct: s.correct, confidentMisses: s.confident_misses }),
            summary: s.summary || undefined,
          }));
        return ok({
          session: started.session,
          method: args.kind === "practice" ? PRACTICE_METHOD : TEACH_METHOD,
          unit,
          held_claims: graph.claims.slice(-60).map((c) => ({ gid: c.gid, name: c.name, statement: c.statement })),
          earlier_sessions: history,
        });
      });
    },
  },
  {
    name: "tutor_session",
    title: "Read a tutoring session",
    description:
      "A session's plan, every answer with confidence and reasoning, and what it taught. Use it to resume one in a new chat.",
    inputSchema: {
      type: "object",
      properties: { session: SESSION },
      required: ["session"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args) {
      return guarded(async () => {
        if (typeof args.session !== "string" || !/^\d+$/.test(args.session))
          return err("session is the number tutor_start returned.");
        const record = await store.readSession(args.session);
        const stats = summarize(
          record.answers.map((a) => ({ correct: a.correct, confidence: a.confidence, dontKnow: a.dont_know })),
        );
        return ok({ ...record, stats });
      });
    },
  },
  {
    name: "tutor_graph",
    title: "The owner's knowledge graph",
    description:
      "Claims the owner has been taught and the chains that connect them (premises that together give a conclusion). Filter by study unit, by words, or both. Use it to link new ideas to old ones and to draw practice problems.",
    inputSchema: {
      type: "object",
      properties: {
        task_gid: TASK,
        search: { type: "string", maxLength: 100, description: "Words that must all appear in a claim." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args) {
      return guarded(async () => {
        let scope: string[] | null = null;
        if (typeof args.task_gid === "string" && /^\d+$/.test(args.task_gid)) {
          const rows = (await loadStudy()).plans.flatMap((p) => p.rows);
          scope = unitScope(rows, args.task_gid);
        }
        const graph = await store.readGraph(scope);
        const claims = searchClaims(graph.claims, typeof args.search === "string" ? args.search : "").slice(0, 60);
        const names = new Map(graph.claims.map((c) => [c.gid, c.name]));
        const shown = new Set(claims.map((c) => c.gid));
        return ok({
          claims: claims.map((c) => ({ gid: c.gid, name: c.name, statement: c.statement })),
          chains: graph.chains
            .filter((h) => shown.has(h.conclusion) || h.premises.some((p) => shown.has(String(p))))
            .map((h) => ({
              premises: h.premises.map((p) => names.get(String(p)) ?? String(p)),
              conclusion: names.get(h.conclusion) ?? h.conclusion,
            })),
        });
      });
    },
  },
  {
    name: "tutor_set_plan",
    title: "Save the lesson plan",
    description:
      "Save the map from what the owner holds to the goal: nodes (id, label, status todo|next|done) and edges [before, after]. Call it again whenever the plan changes; it keeps a revision number.",
    inputSchema: {
      type: "object",
      properties: {
        session: SESSION,
        nodes: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: "^[a-z0-9-]{1,30}$" },
              label: { type: "string", maxLength: 80 },
              status: { enum: ["todo", "next", "done"] },
            },
            required: ["id", "label"],
            additionalProperties: false,
          },
        },
        edges: {
          type: "array",
          maxItems: 120,
          items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
        },
      },
      required: ["session", "nodes"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(args) {
      const r = await ops.setPlan(args.session, args);
      return r.error === undefined ? ok({ saved: true, revision: r.revision }) : err(r.error);
    },
  },
  {
    name: "tutor_record_answer",
    title: "Record an answer",
    description:
      "Record one question and how the owner answered: their answer, how sure they were (0 to 100), their reasoning in their words, and whether it was right. Call it after every probe, prediction, check, recall or practice attempt, so the record survives a dropped chat.",
    inputSchema: {
      type: "object",
      properties: {
        session: SESSION,
        kind: { enum: ["probe", "predict", "check", "recall", "practice"] },
        question: { type: "string", maxLength: 1000 },
        answer: { type: "string", maxLength: 2000, description: "What they answered, in their words." },
        dont_know: { type: "boolean" },
        correct: {
          type: ["boolean", "null"],
          description: "Your verdict; null when it is not a right-or-wrong question.",
        },
        confidence: { type: ["integer", "null"], minimum: 0, maximum: 100 },
        thinking: { type: "string", maxLength: 2000, description: "Their reasoning, as they said it." },
        feedback: {
          type: "string",
          maxLength: 1000,
          description:
            "What you told them about it. For a wrong answer, say the right one in your own words: a missed check comes back as a recall card, and this is the answer they check against.",
        },
        options: { type: "array", maxItems: 8, items: { type: "string" } },
      },
      required: ["session", "kind", "question"],
      additionalProperties: false,
    },
    annotations: WRITE,
    async run(args) {
      const r = await ops.recordAnswer(args.session, args);
      return r.error === undefined ? ok({ saved: true }) : err(r.error);
    },
  },
  {
    name: "tutor_save_claims",
    title: "Save claims and chains",
    description:
      "Save what was taught as claims (one true statement each, in your own words, never book text) and chains (premises that together give a conclusion). Give each new claim a short key; a chain's premises and conclusion are those keys, or the gid of a claim saved earlier. A claim already saved is reused. Returns each key's gid.",
    inputSchema: {
      type: "object",
      properties: {
        session: SESSION,
        claims: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              key: {
                type: "string",
                pattern: "^(?!\\d+$)[a-z0-9-]{1,30}$",
                description: "Local label for this batch; not only digits.",
              },
              name: { type: "string", maxLength: 120 },
              statement: { type: "string", maxLength: 600 },
            },
            required: ["key", "name", "statement"],
            additionalProperties: false,
          },
        },
        chains: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              premises: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
              conclusion: { type: "string" },
            },
            required: ["premises", "conclusion"],
            additionalProperties: false,
          },
        },
      },
      required: ["session"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(args) {
      const r = await ops.saveClaims(args.session, args);
      return r.error === undefined ? ok({ saved: true, claims: r.claims }) : err(r.error);
    },
  },
  {
    name: "tutor_end",
    title: "End a tutoring session",
    description:
      "Close the session with a short summary. For a session on a study unit, review_prompts adds the claims worth recalling to the owner's review queue, each as a question they can answer from memory, with the answer they will check their recall against; checks they got wrong are added by themselves. Mark it dropped if it was abandoned.",
    inputSchema: {
      type: "object",
      properties: {
        session: SESSION,
        status: { enum: ["done", "dropped"] },
        summary: { type: "string", maxLength: 2000 },
        review_prompts: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              prompt: { type: "string", maxLength: 500 },
              answer: {
                type: "string",
                maxLength: 1000,
                description:
                  "The answer, in your own words (the claim's statement), never book text. The owner sees it only after trying to recall, then rates themselves against it.",
              },
              days: { type: "integer", minimum: 1, maximum: 30 },
            },
            required: ["prompt"],
            additionalProperties: false,
          },
        },
      },
      required: ["session", "status"],
      additionalProperties: false,
    },
    annotations: WRITE,
    async run(args, { base }) {
      const r = await ops.endSession(args.session, args);
      return r.error === undefined
        ? ok({ saved: true, reviews_added: r.reviews, see: `${base}/study/learn` })
        : err(r.error);
    },
  },
];
