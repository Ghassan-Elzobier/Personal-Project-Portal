import { commitUrl } from "@/lib/study/github";
import { groupBenchmarks, type BenchmarkRow } from "@/lib/study/benchmarks";
import { shortDate } from "@/lib/dates/week";

/** One result series over time. Its row names it, so it needs no legend. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const width = 96;
  const height = 28;
  const pad = 5;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const x = (i: number) => (values.length === 1 ? width - pad : pad + (i / (values.length - 1)) * (width - pad * 2));
  const y = (v: number) => (high === low ? height / 2 : height - pad - ((v - low) / (high - low)) * (height - pad * 2));
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      {values.length > 1 && <polyline points={points} fill="none" stroke="var(--color-aqua)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      <circle cx={x(values.length - 1)} cy={y(last)} r="4" fill="var(--color-aqua)" />
    </svg>
  );
}

/** Latest results, one row for each metric, scene and GPU. Read-only, so mentors see it too. */
export function BenchmarkTable({ rows }: { rows: BenchmarkRow[] }) {
  const series = groupBenchmarks(rows);
  if (!series.length) return null;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[42rem] text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs text-neutral-300">
            <th scope="col" className="px-4 py-3 font-medium">Measured</th>
            <th scope="col" className="px-4 py-3 font-medium">Scene and GPU</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Latest</th>
            <th scope="col" className="px-4 py-3 font-medium">Since first</th>
            <th scope="col" className="px-4 py-3 font-medium">Trend</th>
            <th scope="col" className="px-4 py-3 font-medium">Commit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {series.map((s) => (
            <tr key={s.key}>
              <th scope="row" className="px-4 py-3 text-left font-medium">{s.metric}</th>
              <td className="px-4 py-3 text-neutral-300">{[s.scene, s.gpu].filter(Boolean).join(" · ") || "Not recorded"}</td>
              <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums">{Number(s.latest.value)} {s.unit}</td>
              <td className="px-4 py-3 whitespace-nowrap text-neutral-300 tabular-nums">
                {s.changePercent === null ? "First result" : `${s.changePercent > 0 ? "+" : ""}${s.changePercent}%${s.improved === null ? "" : s.improved ? ", better" : ", worse"}`}
              </td>
              <td className="px-4 py-2">
                <Sparkline values={s.values} label={`${s.metric}: ${s.values.join(", ")}`} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-neutral-300">
                {s.latest.commit_sha ? (
                  <a href={commitUrl(s.latest.commit_sha)} target="_blank" rel="noreferrer" className="font-mono text-xs text-aqua hover:underline">
                    {s.latest.commit_sha.slice(0, 7)}
                  </a>
                ) : (
                  "–"
                )}{" "}
                <span className="text-xs text-neutral-400">{shortDate(s.latest.created_at.slice(0, 10))}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
