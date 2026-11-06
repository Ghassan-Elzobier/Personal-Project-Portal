import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { usesAsana } from "@/lib/config/env";
import { attempt } from "@/lib/portal/data";
import { LinkPending } from "@/components/link-pending";
import { Empty, ErrorNote, PageHeader } from "@/components/ui";
import { loadJobBoard, mentorSummary } from "@/lib/jobs/load";
import { postingDetail } from "@/lib/jobs/store";
import { RefreshButton } from "./controls";
import { RolePane } from "./role-pane";
import { ApplicationsView, RolesView, SkillsView, SourcesView, type Filters } from "./views";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "roles", title: "Roles", blurb: "What is out there, closest first" },
  { key: "skills", title: "Skills", blurb: "What the market asks, against your plan" },
  { key: "applications", title: "Applications", blurb: "Where each one stands, and what is next" },
  { key: "sources", title: "Sources", blurb: "Who you follow, and adding roles" },
];

const STALE_MS = 12 * 60 * 60 * 1000;

export default async function JobsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  await requireOwner();
  if (usesAsana()) notFound();
  const filters = await searchParams;
  const loaded = await attempt(() => loadJobBoard());

  if (!loaded.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Jobs" />
        <ErrorNote title="Could not load the job tracker" message={`${loaded.error} If this is the first run, its database migration may not be applied yet.`} />
      </div>
    );
  }

  const board = loaded.value;
  const view = TABS.some((t) => t.key === filters.view) ? (filters.view as string) : "roles";
  const selected = filters.role ? board.roles.find((r) => r.gid === filters.role) : undefined;
  const detail = selected ? await attempt(() => postingDetail(selected.gid)) : null;
  const closeFilters = { ...filters, role: undefined };
  const closeHref = `/jobs${Object.values(closeFilters).some(Boolean) ? `?${new URLSearchParams(Object.entries(closeFilters).filter((e): e is [string, string] => Boolean(e[1])))}` : ""}`;
  const feeds = board.sources.filter((s) => s.kind !== "link" && s.active);
  const stale = !board.lastRead || Date.now() - new Date(board.lastRead).getTime() > STALE_MS;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Jobs" />
        <RefreshButton stale={stale} hasSources={feeds.length > 0} />
      </div>

      <nav aria-label="Job tracker" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "roles" ? "/jobs" : `/jobs?view=${tab.key}`}
            aria-current={view === tab.key ? "page" : undefined}
            className={`block rounded-xl p-3 ring-1 transition hover:ring-white/25 ${view === tab.key ? "bg-lavender/15 ring-lavender" : "bg-white/5 ring-white/5"}`}
          >
            <LinkPending />
            <span className="block text-sm font-semibold">{tab.title}</span>
            <span className="block text-xs text-neutral-300">{tab.blurb}</span>
          </Link>
        ))}
      </nav>

      {board.sources.length === 0 && view !== "sources" && (
        <Empty>
          Nothing to read yet. <Link href="/jobs?view=sources" className="text-aqua hover:underline">Follow your first employer</Link> by pasting a job link from them.
        </Empty>
      )}

      {view === "roles" && <RolesView board={board} filters={filters} />}
      {view === "skills" && <SkillsView board={board} summary={mentorSummary(board)} />}
      {view === "applications" && <ApplicationsView board={board} filters={filters} />}
      {view === "sources" && <SourcesView board={board} />}

      {selected && (
        <RolePane
          key={selected.gid}
          role={selected}
          body={detail?.ok ? detail.value.body : ""}
          events={detail?.ok ? detail.value.events : []}
          closeHref={closeHref}
          loadError={detail && !detail.ok ? detail.error : null}
        />
      )}
    </div>
  );
}
