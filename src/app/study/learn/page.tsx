import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { usesAsana } from "@/lib/config/env";
import { shortDate } from "@/lib/dates/week";
import { loadSessions } from "@/lib/tutor/load";
import { TutorError } from "@/lib/tutor/store";
import { Empty, ErrorNote, PageHeader } from "@/components/ui";
import { KindChip, StatusChip } from "./chips";

export const metadata: Metadata = { title: "Learn" };
export const dynamic = "force-dynamic";

export default async function LearnPage() {
  await requireOwner();
  if (usesAsana()) notFound();
  const loaded = await loadSessions().then(
    (value) => ({ ok: true as const, value }),
    (e) => {
      if (e instanceof TutorError) return { ok: false as const, error: e.message };
      throw e;
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Study" title="Learn">
        Lessons Claude has taught you through the portal: what you answered, how sure you were, and what you were
        taught.
      </PageHeader>

      {!loaded.ok ? (
        <ErrorNote title="Could not load your lessons" message={loaded.error} />
      ) : loaded.value.length === 0 ? (
        <Empty>
          No lessons yet. Open a unit on the{" "}
          <Link href="/study" className="link">
            Study page
          </Link>
          , tap Learn with Claude, and paste what it copies into the Claude app.
        </Empty>
      ) : (
        <ul className="space-y-3">
          {loaded.value.map((s) => (
            <li key={s.gid}>
              <Link href={`/study/learn/${s.gid}`} className="card-link space-y-2">
                <span className="flex flex-wrap items-center gap-2">
                  <KindChip kind={s.kind} />
                  <StatusChip status={s.status} />
                  <span className="text-xs text-muted">{[s.unit, shortDate(s.date)].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="block font-semibold">{s.goal}</span>
                {s.result && <span className="block text-sm text-body">{s.result}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
