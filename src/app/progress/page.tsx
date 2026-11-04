import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";
import { projectGid } from "@/lib/config/env";
import { PROJECTS } from "@/lib/config/projects";
import { Empty, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Progress" };

export default async function ProgressIndex() {
  const access = await requireAccess();
  const projects = PROJECTS.filter((p) => projectGid(p.key) && (access.role === "owner" || access.projects.includes(p.key)));

  return (
    <div>
      <PageHeader eyebrow="Read-only" title="Progress">
        {access.role === "owner" ? "What mentors see for each project." : "The projects shared with you."}
      </PageHeader>
      {projects.length === 0 && <Empty>No projects to show yet.</Empty>}
      <ul className="grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <li key={p.key}>
            <Link href={`/progress/${p.key}`} className="card-link h-full space-y-2">
              <p className="eyebrow">{p.area}</p>
              <p className="text-xl font-semibold">{p.title}</p>
              <p className="text-sm text-neutral-400">{p.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
