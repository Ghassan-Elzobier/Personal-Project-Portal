import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { IRIS_XE, MODEL, RX_5700_XT } from "@/lib/lab/guide";
import { achieved, type GpuResult } from "@/lib/lab/results";
import { Figure, Label, Text } from "./kit";
import { SourceChip } from "./shared";

// Where the model meets your measurements: the divergence curve trip by trip,
// and the two GPUs side by side, from the results recorded in the portal.

type Results = Record<"iris" | "rx", GpuResult>;

const GPU_STYLE = {
  iris: { name: "Iris Xe", width: IRIS_XE.subgroup.compiled, line: "stroke-aqua", dot: "fill-aqua", text: "fill-aqua" },
  rx: {
    name: "RX 5700 XT",
    width: RX_5700_XT.subgroup.compiled,
    line: "stroke-lilac",
    dot: "fill-lilac",
    text: "fill-lilac",
  },
} as const;

/** The share of lanes working on each trip: model lines, measured dots. */
export function MeasuredVsModel({ results }: { results: Results }) {
  const id = "fig-measured";
  const X = scaleLinear().domain([1, 8]).range([90, 700]);
  const Y = scaleLinear().domain([0, 1]).range([330, 40]);
  const curve = (values: readonly number[]) =>
    line<number>()
      .x((_, k) => X(k + 1))
      .y((v) => Y(v))([...values]) ?? "";
  const measured = (["iris", "rx"] as const).flatMap((g) =>
    results[g].divergence ? [{ g, d: results[g].divergence! }] : [],
  );
  return (
    <Figure
      id={id}
      w={1000}
      h={380}
      label={`The share of lanes still working on each trip through the bounce loop. The model's curves for 16 wide (the Iris Xe) and 64 wide (the RX 5700 XT) start near 100% for two trips and fall to about ${Math.round(MODEL.perTrip[16][7] * 100)}% and ${Math.round(MODEL.perTrip[64][7] * 100)}% by trip 8. ${measured.length ? "Dots are your measurements." : "No measurement is recorded yet."}`}
    >
      <line x1={X(1)} y1={Y(0)} x2={X(8)} y2={Y(0)} className="stroke-white/40" />
      <line x1={X(1)} y1={Y(0)} x2={X(1)} y2={Y(1)} className="stroke-white/40" />
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={X(1)} y1={Y(v)} x2={X(8)} y2={Y(v)} className="stroke-white/5" />
          <Text x={X(1) - 10} y={Y(v) + 4} anchor="end" className="fill-muted text-[11px]">{`${v * 100}%`}</Text>
        </g>
      ))}
      {Array.from({ length: 8 }, (_, k) => (
        <Text key={k} x={X(k + 1)} y={Y(0) + 20} anchor="middle" className="fill-muted text-[11px]">
          {String(k + 1)}
        </Text>
      ))}
      <Text x={(X(1) + X(8)) / 2} y={Y(0) + 40} anchor="middle" className="fill-muted text-[11.5px]">
        trip through the bounce loop
      </Text>
      <Text x={20} y={24} className="fill-white text-[14px] font-semibold">
        Lanes still working, trip by trip
      </Text>

      {(["iris", "rx"] as const).map((g) => {
        const s = GPU_STYLE[g];
        const values = MODEL.perTrip[s.width as 16 | 64];
        return (
          <g key={g}>
            <path d={curve(values)} fill="none" className={s.line} strokeWidth={2} strokeDasharray="6 4" />
            <Label
              x={X(8) + 10}
              y={Y(values[7]) + (g === "iris" ? -2 : 14)}
              anchor="start"
              size={11}
              tone={g === "iris" ? "shader" : "gpu"}
            >{`${s.name} model, ${s.width} wide`}</Label>
          </g>
        );
      })}
      {measured.map(({ g, d }) => {
        const s = GPU_STYLE[g];
        return (
          <g key={g}>
            <path d={curve(d.perTrip)} fill="none" className={s.line} strokeWidth={2.5} />
            {d.perTrip.map((v, k) => (
              <circle key={k} cx={X(k + 1)} cy={Y(v)} r={4.5} className={`${s.dot} stroke-primary`} strokeWidth={1.5} />
            ))}
          </g>
        );
      })}

      <rect
        x={760}
        y={60}
        width={220}
        height={measured.length ? 160 : 120}
        rx={10}
        className="fill-white/5 stroke-white/15"
      />
      <Text x={776} y={84} className="fill-white text-[13px] font-semibold">
        Over the whole loop
      </Text>
      <Text
        x={776}
        y={108}
        className="fill-aqua text-[12.5px]"
      >{`Iris Xe model: ${Math.round(MODEL.efficiency[16] * 100)}%`}</Text>
      <Text
        x={776}
        y={128}
        className="fill-lilac text-[12.5px]"
      >{`RX 5700 XT model: ${Math.round(MODEL.efficiency[64] * 100)}%`}</Text>
      {measured.length ? (
        measured.map(({ g, d }, i) => (
          <Text
            key={g}
            x={776}
            y={156 + i * 20}
            className={`${GPU_STYLE[g].text} text-[12.5px] font-semibold`}
          >{`${GPU_STYLE[g].name} measured: ${Math.round(d.overall * 100)}% at ${d.subgroup}`}</Text>
        ))
      ) : (
        <Text x={776} y={156} className="fill-muted text-[12px]">
          Nothing measured yet
        </Text>
      )}
      <Text x={776} y={measured.length ? 204 : 180} className="fill-muted text-[11px]">
        Dashed: model. Solid with dots: yours.
      </Text>
    </Figure>
  );
}

/** Both GPUs in one table: what was recorded, what the driver compiled, what it implies. */
export function GpuTable({ results }: { results: Results }) {
  const rows = (["iris", "rx"] as const).map((g) => {
    const r = results[g];
    const a = r.dispatch ? achieved(r.dispatch.ms) : null;
    return { g, r, a };
  });
  const cell = "py-2 pr-4 align-top";
  const compiled = {
    iris: `SIMD${IRIS_XE.subgroup.compiled}, 2,197 instructions, no spills`,
    rx: `wave${RX_5700_XT.subgroup.compiled}, ${RX_5700_XT.wave64.vgprs} vector registers, 1,951 instructions, no spills`,
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th scope="col" className="py-1.5 pr-4 font-normal" />
            <th scope="col" className="py-1.5 pr-4 font-normal">
              Iris Xe (laptop)
            </th>
            <th scope="col" className="py-1.5 pr-4 font-normal">
              RX 5700 XT (desktop)
            </th>
            <th scope="col" className="py-1.5 font-normal">
              From
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          <tr>
            <th scope="row" className={`${cell} font-normal text-muted`}>
              Dispatch, 800 × 600
            </th>
            {rows.map(({ g, r }) => (
              <td key={g} className={`${cell} tabular-nums`}>
                {r.dispatch ? `${r.dispatch.ms} ms` : "not recorded"}
                {r.dispatch?.commit && (
                  <span className="block text-xs text-faint">
                    at {r.dispatch.commit}, {r.dispatch.date}
                  </span>
                )}
              </td>
            ))}
            <td className={cell}>
              <SourceChip source="measured" />
            </td>
          </tr>
          <tr>
            <th scope="row" className={`${cell} font-normal text-muted`}>
              Paths a second
            </th>
            {rows.map(({ g, a }) => (
              <td key={g} className={`${cell} tabular-nums`}>
                {a ? `${Math.round(a.mpaths).toLocaleString("en-GB")} million` : "—"}
              </td>
            ))}
            <td className={cell}>
              <SourceChip source="measured" />
            </td>
          </tr>
          <tr>
            <th scope="row" className={`${cell} font-normal text-muted`}>
              Achieved
            </th>
            {rows.map(({ g, a }) => (
              <td key={g} className={`${cell} tabular-nums`}>
                {a ? `${Math.round(a.gflops).toLocaleString("en-GB")} GFLOP/s, ${Math.round(a.gbs)} GB/s` : "—"}
                {g === "rx" && a && (
                  <span className="block text-xs text-faint">
                    {Math.round(a.ofRxRoof * 100)}% of its paper roof at 9 FLOP/B
                  </span>
                )}
              </td>
            ))}
            <td className={cell}>
              <SourceChip source="model" />
            </td>
          </tr>
          <tr>
            <th scope="row" className={`${cell} font-normal text-muted`}>
              Compiled as
            </th>
            {rows.map(({ g }) => (
              <td key={g} className={cell}>
                {compiled[g]}
              </td>
            ))}
            <td className={cell}>
              <SourceChip source="measured" />
            </td>
          </tr>
          <tr>
            <th scope="row" className={`${cell} font-normal text-muted`}>
              Bounce-loop efficiency
            </th>
            {rows.map(({ g, r }) => (
              <td key={g} className={`${cell} tabular-nums`}>
                {`model ${Math.round(MODEL.efficiency[g === "iris" ? 16 : 64] * 100)}% at ${g === "iris" ? 16 : 64} wide`}
                <span className="block text-xs text-faint">
                  {r.divergence
                    ? `measured ${Math.round(r.divergence.overall * 100)}% at ${r.divergence.subgroup}`
                    : "not measured yet"}
                </span>
              </td>
            ))}
            <td className={cell}>
              <SourceChip source="model" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
