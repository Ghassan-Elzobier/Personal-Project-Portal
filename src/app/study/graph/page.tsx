import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { usesAsana } from "@/lib/config/env";
import { loadGraph } from "@/lib/tutor/load";
import { TutorError } from "@/lib/tutor/store";
import { Empty, ErrorNote, PageHeader } from "@/components/ui";
import { GraphView } from "./graph-view";

export const metadata: Metadata = { title: "Knowledge graph" };
export const dynamic = "force-dynamic";

export default async function GraphPage() {
  await requireOwner();
  if (usesAsana()) notFound();
  const loaded = await loadGraph().then(
    (groups) => ({ ok: true as const, groups }),
    (e) => {
      if (e instanceof TutorError) return { ok: false as const, error: e.message };
      throw e;
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Study" title="Knowledge graph">
        What you have been taught, in your own words. Each idea shows what it follows from, with the ideas that were
        needed together, and what it leads to.
      </PageHeader>

      {!loaded.ok ? (
        <ErrorNote title="Could not load the graph" message={loaded.error} />
      ) : loaded.groups.length === 0 ? (
        <Empty>
          Nothing here yet. Claims are saved when Claude finishes teaching a{" "}
          <Link href="/study/learn" className="link">
            lesson
          </Link>
          .
        </Empty>
      ) : (
        <GraphView groups={loaded.groups} />
      )}
    </div>
  );
}
