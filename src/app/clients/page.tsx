import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import {
  clientTree,
  PRICING_LABELS,
  RELATIONSHIP_LABELS,
  summary,
  type ClientView,
  type Milestone,
  type ProjectView,
  type Summary,
} from "@/lib/clients/clients";
import { loadClients } from "@/lib/clients/operations";
import { shortDate } from "@/lib/dates/week";
import { pounds } from "@/lib/money/state";
import { Chip, DueDate, Empty, ErrorNote, Fold, PageHeader, SectionTitle } from "@/components/ui";
import {
  AddClient,
  AddMilestone,
  AddProject,
  MilestoneButtons,
  ProjectDetails,
  RemoveButton,
  StageSelect,
} from "./parts";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

// Software the owner builds for other people: each client's projects, their
// stage, next milestone and money. For the owner alone: none of it becomes a
// task, so mentors never see it. Claude reads and changes it too
// (list_client_projects).

export default async function ClientsPage() {
  // Both start at once: clients_read checks for the owner itself.
  const [, loaded] = await Promise.all([requireOwner(), loadClients()]);
  if (loaded.error !== undefined) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader eyebrow="Work" title="Clients" />
        <ErrorNote message={loaded.error} />
      </div>
    );
  }
  const tree = clientTree(loaded.data);
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader eyebrow="Work" title="Clients">
        Software you build for other people: each project&apos;s stage, next milestone and money. Only you see this
        page. None of it becomes a task, so mentors never do.
      </PageHeader>

      {tree.length > 0 && <Headline s={summary(tree)} today={loaded.today} />}

      {tree.length === 0 ? (
        <Empty>No clients yet. Add one below, or ask Claude to add one with their first project.</Empty>
      ) : (
        tree.map((c) => <ClientSection key={c.gid} c={c} today={loaded.today} />)
      )}

      <section aria-label="Add a client">
        <SectionTitle>Add a client</SectionTitle>
        <AddClient />
      </section>
    </div>
  );
}

function Headline({ s, today }: { s: Summary; today: string }) {
  return (
    <section aria-label="At a glance" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="card">
        <p className="eyebrow">Live projects</p>
        <p className="text-2xl font-semibold tabular-nums">{s.liveProjects}</p>
      </div>
      <div className="card">
        <p className="eyebrow">Owed to you</p>
        <p className={`text-2xl font-semibold tabular-nums ${s.owedPence > 0 ? "text-sand" : ""}`}>
          {pounds(s.owedPence)}
        </p>
      </div>
      <div className="min-w-0 card">
        <p className="eyebrow">Next milestone</p>
        {s.next ? (
          <>
            <p className="font-medium wrap-break-word">{s.next.milestone.title}</p>
            <p className="text-xs wrap-break-word text-muted">
              {s.next.client} · {s.next.project}
              {s.next.milestone.dueOn && (
                <>
                  {" · "}
                  <DueDate dueOn={s.next.milestone.dueOn} today={today} />
                </>
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">Nothing waiting.</p>
        )}
      </div>
    </section>
  );
}

function ClientSection({ c, today }: { c: ClientView; today: string }) {
  const details = [RELATIONSHIP_LABELS[c.relationship], c.channel, c.timeZone].filter(Boolean).join(" · ");
  return (
    <section aria-label={c.name} className="space-y-4">
      <SectionTitle
        action={
          <RemoveButton
            kind="client"
            gid={c.gid}
            label={`Delete client ${c.name}`}
            confirm="Delete this client, with every project and milestone, for good?"
          />
        }
      >
        <span className="wrap-break-word">{c.name}</span>
      </SectionTitle>
      <p className="-mt-2 text-sm text-muted">{details}</p>
      {c.notes && <p className="text-sm wrap-break-word text-body">{c.notes}</p>}
      {c.projects.length > 0 ? (
        <ul className="space-y-4">
          {c.projects.map((p) => (
            <ProjectCard key={p.gid} p={p} today={today} />
          ))}
        </ul>
      ) : (
        <Empty>No projects yet. Add the first one below.</Empty>
      )}
      <AddProject clientGid={c.gid} clientName={c.name} />
    </section>
  );
}

function ProjectCard({ p, today }: { p: ProjectView; today: string }) {
  const links = [
    { label: "Repo", url: p.repoUrl },
    { label: "Preview", url: p.previewUrl },
    { label: "Live", url: p.liveUrl },
  ].filter((l): l is { label: string; url: string } => l.url !== null);
  return (
    <li className="space-y-4 card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold wrap-break-word text-bright">{p.title}</h3>
          <p className="text-xs text-muted">
            {PRICING_LABELS[p.pricing]}
            {p.agreedPence > 0 && (
              <span className="tabular-nums">
                {" · "}
                {pounds(p.agreedPence)} agreed, {pounds(p.paidPence)} paid
              </span>
            )}
            {p.owedPence > 0 && <span className="text-sand tabular-nums"> · {pounds(p.owedPence)} owed</span>}
          </p>
        </div>
        <StageSelect gid={p.gid} title={p.title} stage={p.stage} />
      </div>

      {links.length > 0 && (
        <p className="flex flex-wrap gap-x-4 text-sm">
          {links.map(({ label, url }) => (
            <a key={label} href={url} target="_blank" rel="noreferrer" className="link">
              {label}
            </a>
          ))}
        </p>
      )}

      {p.milestones.length > 0 ? (
        <ul aria-label={`Milestones of ${p.title}`} className="divide-y divide-white/5">
          {p.milestones.map((m) => (
            <MilestoneItem key={m.gid} m={m} today={today} next={p.next?.gid === m.gid} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No milestones yet. Add the first deliverable below.</p>
      )}

      <Fold title="Add a milestone" open={p.milestones.length === 0}>
        <div className="mt-2">
          <AddMilestone projectGid={p.gid} projectTitle={p.title} />
        </div>
      </Fold>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <ProjectDetails
          key={[p.repoUrl, p.previewUrl, p.liveUrl, p.notes].join("\n")}
          gid={p.gid}
          title={p.title}
          repoUrl={p.repoUrl}
          previewUrl={p.previewUrl}
          liveUrl={p.liveUrl}
          notes={p.notes}
        />
        <RemoveButton
          kind="project"
          gid={p.gid}
          label={`Delete project ${p.title}`}
          confirm="Delete this project and its milestones for good?"
        />
      </div>
    </li>
  );
}

function MilestoneItem({ m, today, next }: { m: Milestone; today: string; next: boolean }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium wrap-break-word">
          {m.title}
          {next && <Chip tone="aqua">Next</Chip>}
        </p>
        <p className="flex flex-wrap gap-x-3 text-xs text-muted">
          {m.acceptedOn ? <span>Accepted {shortDate(m.acceptedOn)}</span> : <DueDate dueOn={m.dueOn} today={today} />}
          {m.amountPence !== null && <span className="tabular-nums">{pounds(m.amountPence)}</span>}
          {m.paidOn && <span className="text-mint">Paid {shortDate(m.paidOn)}</span>}
        </p>
      </div>
      <MilestoneButtons gid={m.gid} title={m.title} accepted={m.acceptedOn !== null} paid={m.paidOn !== null} />
    </li>
  );
}
