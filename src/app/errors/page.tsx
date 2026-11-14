import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { now } from "@/lib/dates/clock";
import { ago, dailySeries, type ErrorRow } from "@/lib/errors/dashboard";
import { contextLabel } from "@/lib/errors/display";
import { createClient } from "@/lib/supabase/server";
import { DailyBars } from "@/components/daily-bars";
import { Empty, ErrorNote, PageHeader, SectionTitle } from "@/components/ui";
import { TestErrorButtons } from "./controls";
import { ErrorStatus } from "./parts";

export const metadata: Metadata = { title: "Errors" };
export const dynamic = "force-dynamic";

type List = { errors: ErrorRow[]; open: number; ignored: number };

export default async function ErrorsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireOwner();
  const ignored = (await searchParams).show === "ignored";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("error_list", { p_show: ignored ? "ignored" : "open" });
  const list = (data as List | null) ?? { errors: [], open: 0, ignored: 0 };
  const at = now();
  const today = at.toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader eyebrow="Production" title="Errors">
        Every error the live portal hit, with anything personal taken out. New ones become GitHub issues, and Claude
        opens a fix for each.
      </PageHeader>

      <section>
        <SectionTitle
          action={
            <Link href={ignored ? "/errors" : "/errors?show=ignored"} className="tap text-sm link">
              {ignored ? `Open (${list.open})` : `Ignored (${list.ignored})`}
            </Link>
          }
        >
          {ignored ? "Ignored" : "Open"}
        </SectionTitle>
        {error && <ErrorNote message={error.message} />}
        {!error && list.errors.length === 0 && (
          <Empty>
            {ignored
              ? "Nothing is ignored."
              : "No errors. When the live portal hits one, it shows here and becomes a GitHub issue."}
          </Empty>
        )}
        <ul className="space-y-3">
          {list.errors.map((e) => (
            <li key={e.fingerprint}>
              <Link href={`/errors/${e.fingerprint}`} className="card-link">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <ErrorStatus error={e} />
                      <span className="text-sm text-muted">{e.name}</span>
                    </div>
                    <p className="font-medium wrap-break-word text-white">{e.message}</p>
                    <p className="text-xs wrap-break-word text-muted">
                      <span className="font-mono">{e.route}</span>, {contextLabel(e.context)} ·{" "}
                      {e.occurrences === 1 ? "once" : `${e.occurrences} times`} · {ago(e.last_seen, at)}
                    </p>
                  </div>
                  <DailyBars size="compact" label="Last 14 days" days={dailySeries(e.daily, today, 14)} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle>Check the pipeline</SectionTitle>
        <div className="space-y-4 card">
          <p className="text-sm text-body">
            Send a test error to see one arrive with its stack mapped back to the source. Test errors stay on this page
            and never become GitHub issues.
          </p>
          <TestErrorButtons />
        </div>
      </section>
    </div>
  );
}
