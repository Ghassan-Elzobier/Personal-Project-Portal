import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { usesAsana } from "@/lib/config/env";
import { shortDate } from "@/lib/dates/week";
import { loadSession } from "@/lib/tutor/load";
import { CONFIDENT } from "@/lib/tutor/stats";
import { TutorError, type AnswerRow } from "@/lib/tutor/store";
import { Chip, Empty, ErrorNote, PageHeader, SectionTitle } from "@/components/ui";
import { KindChip, StatusChip } from "../chips";
import { PlanList } from "./plan-list";

export const metadata: Metadata = { title: "Lesson" };
export const dynamic = "force-dynamic";

const ANSWER_KINDS: Record<AnswerRow["kind"], string> = {
  probe: "Probe",
  predict: "Prediction",
  check: "Check",
  recall: "Recall",
  practice: "Practice",
};

function Verdict({ a }: { a: AnswerRow }) {
  if (a.dont_know) return <Chip tone="quiet">Did not know</Chip>;
  if (a.correct === null) return null;
  if (a.correct) return <Chip tone="mint">Right</Chip>;
  return (a.confidence ?? 0) >= CONFIDENT ? <Chip tone="sand">Sure but wrong</Chip> : <Chip tone="coral">Wrong</Chip>;
}

export default async function LessonPage({ params }: { params: Promise<{ gid: string }> }) {
  await requireOwner();
  if (usesAsana()) notFound();
  const { gid } = await params;
  if (!/^\d+$/.test(gid)) notFound();
  let view;
  try {
    view = await loadSession(gid);
  } catch (e) {
    if (!(e instanceof TutorError)) throw e;
    if (/does not exist/.test(e.message)) notFound();
    return <ErrorNote title="Could not load this lesson" message={e.message} />;
  }
  const { card, plan, stats, answers, claims } = view;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={[card.unit, shortDate(card.date)].filter(Boolean).join(" · ") || "Lesson"} title={card.goal}>
        <span className="flex flex-wrap items-center gap-2">
          <KindChip kind={card.kind} />
          <StatusChip status={card.status} />
          {card.result && <Chip>{card.result}</Chip>}
          {stats.calibration && (
            <Chip title="How sure you said you were, against how often you were right">
              Sure {Math.round(stats.calibration.confidence * 100)}%, right{" "}
              {Math.round(stats.calibration.accuracy * 100)}%
            </Chip>
          )}
        </span>
        {card.summary && <span className="mt-3 block">{card.summary}</span>}
      </PageHeader>

      <section>
        <SectionTitle>Plan</SectionTitle>
        {plan ? <PlanList plan={plan} /> : <Empty>Claude did not save a plan for this one.</Empty>}
      </section>

      <section>
        <SectionTitle>Your answers</SectionTitle>
        {answers.length === 0 ? (
          <Empty>No answers were recorded.</Empty>
        ) : (
          <ol className="space-y-3">
            {answers.map((a) => (
              <li key={a.gid} className="space-y-2 card">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="ice">{ANSWER_KINDS[a.kind]}</Chip>
                  <Verdict a={a} />
                  {a.confidence !== null && <Chip>Sure {a.confidence}%</Chip>}
                </div>
                <p className="font-semibold">{a.question}</p>
                {a.answer && <p className="text-sm text-body">You said: {a.answer}</p>}
                {a.thinking && <p className="text-sm text-muted">Your thinking: {a.thinking}</p>}
                {a.feedback && <p className="text-sm text-body">{a.feedback}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <SectionTitle>What you were taught</SectionTitle>
        {claims.length === 0 ? (
          <Empty>Nothing was saved from this lesson.</Empty>
        ) : (
          <ul className="space-y-2">
            {claims.map((c) => (
              <li key={c.gid} className="card">
                <p className="font-semibold">{c.name}</p>
                <p className="text-sm text-body">{c.statement}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="flex flex-wrap gap-x-6 gap-y-2">
        <Link href="/study/learn" className="link">
          All lessons
        </Link>
        <Link href="/study/graph" className="link">
          Knowledge graph
        </Link>
      </p>
    </div>
  );
}
