import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { githubRepo } from "@/lib/config/env";
import { now } from "@/lib/dates/clock";
import { ago, dailySeries, devices, frames, type ErrorDetail } from "@/lib/errors/dashboard";
import { contextLabel, deviceLabel, sourceLabel } from "@/lib/errors/display";
import { createClient } from "@/lib/supabase/server";
import { DailyBars } from "@/components/daily-bars";
import { Chip, Empty, ErrorNote, PageHeader, SectionTitle } from "@/components/ui";
import { IgnoreButton } from "../controls";
import { ErrorStatus } from "../parts";

export const metadata: Metadata = { title: "Error" };
export const dynamic = "force-dynamic";

const REPORTERS = { owner: "you", mentor: "a mentor", connector: "Claude's connector" };

function Fact({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 rounded-xl bg-white/5 p-3 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm wrap-break-word text-white">{children}</dd>
    </div>
  );
}

export default async function ErrorPage({ params }: { params: Promise<{ fingerprint: string }> }) {
  await requireOwner();
  const { fingerprint } = await params;
  if (!/^[0-9a-f]{32}$/.test(fingerprint)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("error_detail", { p_fingerprint: fingerprint });
  if (error) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/errors" className="tap text-sm link">
          All errors
        </Link>
        <ErrorNote title="Could not load this error" message={error.message} />
      </div>
    );
  }
  if (!data) notFound();

  const e = data as ErrorDetail;
  const at = now();
  const repo = githubRepo();
  const latest = e.events[0];
  const seenOn = devices(e.events);
  const stack = frames(e.stack, e.release, repo);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <Link href="/errors" className="tap text-sm link">
          All errors
        </Link>
        <PageHeader eyebrow={`From ${sourceLabel(e.source)}, ${contextLabel(e.context)}`} title={e.name}>
          <span className="wrap-break-word">{e.message}</span>
        </PageHeader>
        <div className="-mt-4 flex flex-wrap items-center gap-3">
          <ErrorStatus error={e} />
          <IgnoreButton fingerprint={e.fingerprint} ignored={e.status === "ignored"} />
          {repo && e.issue_number && (
            <a href={`https://github.com/${repo}/issues/${e.issue_number}`} className="tap text-sm link">
              Open issue #{e.issue_number}
            </a>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Where" wide>
          <span className="font-mono text-xs">{e.route}</span>
        </Fact>
        <Fact label="Seen">{e.occurrences === 1 ? "Once" : `${e.occurrences} times`}</Fact>
        <Fact label="Release">
          {e.release && repo ? (
            <a href={`https://github.com/${repo}/commit/${e.release}`} className="font-mono text-xs link">
              {e.release.slice(0, 7)}
            </a>
          ) : (
            <span className="font-mono text-xs">{e.release ? e.release.slice(0, 7) : "Unknown"}</span>
          )}
        </Fact>
        <Fact label="First">{ago(e.first_seen, at)}</Fact>
        <Fact label="Last">{ago(e.last_seen, at)}</Fact>
      </dl>

      <section>
        <SectionTitle>Last 30 days</SectionTitle>
        <div className="card">
          <DailyBars label="Occurrences per day" days={dailySeries(e.daily, at.toISOString().slice(0, 10), 30)} />
        </div>
      </section>

      <section>
        <SectionTitle>Stack</SectionTitle>
        {stack.length === 0 ? (
          <Empty>No stack was recorded for this error.</Empty>
        ) : (
          <ol className="space-y-1.5 card font-mono text-xs">
            {stack.map((f, i) => (
              <li key={i} className={`break-all ${f.own ? "text-bright" : "text-faint"}`}>
                {f.href ? (
                  <a href={f.href} className="link">
                    {f.text}
                  </a>
                ) : (
                  f.text
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-xs text-muted">
          The app&apos;s own frames are bright{repo && e.release ? " and link to their line on GitHub" : ""}.
        </p>
      </section>

      <section>
        <SectionTitle>What happened before</SectionTitle>
        {!latest || latest.breadcrumbs.length === 0 ? (
          <Empty>Nothing was recorded before this error. Server errors carry no breadcrumbs.</Empty>
        ) : (
          <ol className="space-y-2 card text-sm">
            {latest.breadcrumbs.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs text-muted tabular-nums">{c.at.slice(11, 19)}</span>
                <Chip tone="quiet">{c.kind}</Chip>
                <span className="min-w-0 wrap-break-word text-body">{c.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <SectionTitle>Recent occurrences</SectionTitle>
        {e.events.length === 0 ? (
          <Empty>No occurrences are kept for this error yet.</Empty>
        ) : (
          <ul className="divide-y divide-white/5 card py-1">
            {e.events.slice(0, 10).map((ev, i) => (
              <li key={i} className="py-2.5 text-sm">
                <p className="text-white">{ago(ev.occurred_at, at)}</p>
                <p className="text-xs wrap-break-word text-muted">
                  {deviceLabel(ev) ?? "Unknown device"} · hit by {REPORTERS[ev.reporter]}
                  {ev.release ? ` · release ${ev.release.slice(0, 7)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {seenOn.length > 0 && (
        <section>
          <SectionTitle>Devices</SectionTitle>
          <ul className="space-y-2 card text-sm">
            {seenOn.map((d) => (
              <li key={d.label} className="flex justify-between gap-4">
                <span className="min-w-0 wrap-break-word text-body">{d.label}</span>
                <span className="text-muted tabular-nums">{d.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
