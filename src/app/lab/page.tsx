import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { CODE_MAP, MODEL, PARTS, RENDERER, VIEWS, allFindings, codeHref } from "@/lib/lab/guide";
import { latestResults } from "@/lib/lab/results";
import { attempt } from "@/lib/portal/data";
import { loadStudy } from "@/lib/study/load";
import { GpuTable } from "./figures-measured";
import { PageHeader, SectionTitle } from "@/components/ui";
import { FrameMap } from "./figures-host";
import { Legend } from "./kit";
import { DriftBanner, FindingCard } from "./shared";
import { rendererDrift } from "@/lib/lab/drift";

export const metadata: Metadata = { title: "Lab" };
export const dynamic = "force-dynamic";

export default async function LabPage() {
  await requireOwner();
  const findings = allFindings();
  const [study, drift] = await Promise.all([attempt(() => loadStudy()), rendererDrift()]);
  const results = latestResults(study.ok ? study.value.study.benchmarks.filter((b) => b.project === "rendering") : []);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Rendering lab" title="How the renderer works">
        Your path tracer, drawn from its code at commit{" "}
        <a
          href={`${RENDERER.repo}/tree/${RENDERER.commit}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-aqua hover:underline"
        >
          {RENDERER.short}
        </a>
        . Each figure numbers its steps, each step links to the lines that do it, and each view says where PMPP explains
        it.
      </PageHeader>

      <DriftBanner drift={drift} />

      <section aria-labelledby="map-title" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="map-title" className="text-xl font-semibold">
            Start here: one frame
          </h2>
          <Legend />
        </div>
        <FrameMap links />
        <p className="max-w-3xl text-sm text-neutral-400">
          Each box opens the view that explains it. The same colours mean the same thing in every figure.
        </p>
      </section>

      {PARTS.filter((part) => part.id !== "start").map((part) => (
        <section
          key={part.id}
          id={`part-${part.id}`}
          aria-labelledby={`title-${part.id}`}
          className="scroll-mt-24 space-y-3"
        >
          <div>
            <h2 id={`title-${part.id}`} className="text-xl font-semibold">
              {part.title}
            </h2>
            <p className="subtext">{part.blurb}</p>
          </div>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {VIEWS.filter((v) => v.part === part.id).map((v) => {
              const bugs = (v.findings ?? []).filter((f) => f.kind === "bug").length;
              const checks = (v.findings ?? []).filter((f) => f.kind === "check").length;
              return (
                <li key={v.id}>
                  <Link href={`/lab/${v.id}`} className="card-link h-full space-y-2">
                    <span className="block eyebrow">View {VIEWS.indexOf(v) + 1}</span>
                    <span className="block text-lg font-semibold">{v.title}</span>
                    <span className="line-clamp-3 block text-sm text-neutral-300">{v.claim}</span>
                    <span className="flex flex-wrap gap-1.5 pt-1">
                      {v.book.slice(0, 3).map((b) => (
                        <span key={b.section} className="chip bg-white/5 text-neutral-300 ring-white/10">
                          PMPP {b.section}
                        </span>
                      ))}
                      {bugs > 0 && <span className="chip bg-coral/10 text-coral ring-coral/30">{bugs} bug</span>}
                      {checks > 0 && <span className="chip bg-sand/10 text-sand ring-sand/30">{checks} to check</span>}
                      {(v.id === "divergence" || v.id === "sync") && (
                        <span className="chip bg-aqua/10 text-aqua ring-aqua/30">Interactive</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <section aria-labelledby="found-title" className="space-y-3">
        <SectionTitle>
          <span id="found-title">Found while drawing</span>
        </SectionTitle>
        <p className="max-w-3xl text-sm text-neutral-400">
          Drawing each part meant reading it closely. These are what turned up, worst first. The bug was confirmed with
          the validation layer; the rest come from the code and the model.
        </p>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {findings
            .filter((f) => f.kind !== "note")
            .map((f) => (
              <FindingCard key={f.title} finding={f} view={{ id: f.view, title: f.viewTitle }} />
            ))}
        </div>
      </section>

      <section aria-labelledby="map-code-title" className="space-y-3">
        <SectionTitle>
          <span id="map-code-title">Your code, line by line</span>
        </SectionTitle>
        <p className="max-w-3xl text-sm text-neutral-400">
          Every line of main.cpp, raytrace.comp and CMakeLists.txt, and the view that explains it. A test checks that no
          line is left out.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-neutral-400">
              <tr>
                <th scope="col" className="py-1.5 pr-4 font-normal">
                  Lines
                </th>
                <th scope="col" className="py-1.5 pr-4 font-normal">
                  What
                </th>
                <th scope="col" className="py-1.5 font-normal">
                  Explained in
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {CODE_MAP.map((c) => (
                <tr key={`${c.file}-${c.from}`}>
                  <td className="py-1.5 pr-4 whitespace-nowrap">
                    <a
                      href={codeHref([c.file, c.from, c.to])}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-aqua hover:underline"
                    >
                      {c.file === "main" ? "main.cpp" : c.file === "shader" ? "raytrace.comp" : "CMakeLists.txt"}:
                      {c.from}–{c.to}
                    </a>
                  </td>
                  <td className="py-1.5 pr-4 text-neutral-300">{c.what}</td>
                  <td className="py-1.5">
                    <span className="flex flex-wrap gap-x-3">
                      {c.views.map((id) => (
                        <Link key={id} href={`/lab/${id}`} className="hover:underline">
                          {VIEWS.find((v) => v.id === id)?.title}
                        </Link>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="numbers-title" className="space-y-3">
        <SectionTitle>
          <span id="numbers-title">Your two GPUs</span>
        </SectionTitle>
        <p className="max-w-3xl text-sm text-neutral-400">
          Dispatch times come from the results you recorded in Study. The rest: Mesa compiled the shader for the Iris Xe
          on this laptop, and RADV, the RX 5700 XT&apos;s Linux driver, compiled it for that card&apos;s chip without
          the card. Efficiency is counted by lane time, as a GPU counter would.
        </p>
        <GpuTable results={results} />
        <p className="text-xs text-neutral-400">
          Model, frame 0 at 800 × 600: {MODEL.meanTrips} trips per path, {pct(MODEL.escapeFirstTrip)} leaving on the
          first, about {MODEL.flopPerPath} FLOP over {MODEL.bytesPerPixel} bytes. If the desktop runs Windows,
          AMD&apos;s own driver compiles differently from RADV; Radeon GPU Profiler shows what it does.{" "}
          <Link href="/study?project=rendering" className="text-aqua hover:underline">
            Record a result
          </Link>
          .
        </p>
      </section>

      <p className="text-sm text-neutral-400">
        The lines linked here are the ones at {RENDERER.short}. When main.cpp is split into modules, the figures still
        hold but the line links need moving. The{" "}
        <Link href="/study?project=rendering" className="text-aqua hover:underline">
          Rendering lab plan
        </Link>{" "}
        and the{" "}
        <Link href="/library" className="text-aqua hover:underline">
          book
        </Link>{" "}
        link back here.
      </p>
    </div>
  );
}
