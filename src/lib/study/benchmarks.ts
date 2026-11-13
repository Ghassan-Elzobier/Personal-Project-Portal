// Renderer results over time. Pure, so it is tested with node's test runner.

export const METRICS: { name: string; unit: string; higherIsBetter: boolean }[] = [
  { name: "Frame time", unit: "ms", higherIsBetter: false },
  { name: "Million rays per second", unit: "Mrays/s", higherIsBetter: true },
  { name: "BVH build time", unit: "ms", higherIsBetter: false },
  { name: "Traversal steps per ray", unit: "steps", higherIsBetter: false },
  { name: "SAH cost", unit: "", higherIsBetter: false },
  { name: "Sort time", unit: "ms", higherIsBetter: false },
  { name: "Image error (RMSE)", unit: "", higherIsBetter: false },
  { name: "PSNR", unit: "dB", higherIsBetter: true },
  { name: "Training time", unit: "min", higherIsBetter: false },
  { name: "Memory bandwidth", unit: "GB/s", higherIsBetter: true },
  { name: "Compute throughput", unit: "TFLOPS", higherIsBetter: true },
  { name: "SIMD efficiency", unit: "%", higherIsBetter: true },
];

/** The GPUs results usually come from, offered when recording one. */
export const GPUS = ["RX 5700 XT", "Iris Xe"];

export type BenchmarkRow = {
  gid: string;
  project: string;
  task_gid: string | null;
  metric: string;
  value: number | string;
  unit: string;
  scene: string;
  gpu: string;
  commit_sha: string | null;
  notes: string;
  created_at: string;
};

export type BenchmarkSeries = {
  key: string;
  metric: string;
  unit: string;
  scene: string;
  gpu: string;
  values: number[];
  latest: BenchmarkRow;
  /** Change from the first result, as a percentage. Null with only one result or a zero start. */
  changePercent: number | null;
  /** Null when there is no change to judge, or the metric is not a known one. */
  improved: boolean | null;
};

/** Only results from the same metric, scene and GPU can be compared, so each is its own series. */
export function groupBenchmarks(rows: BenchmarkRow[]): BenchmarkSeries[] {
  const groups = new Map<string, BenchmarkRow[]>();
  for (const r of rows) {
    const key = [r.metric, r.scene, r.gpu].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const values = list.map((r) => Number(r.value));
    const first = values[0];
    const last = values[values.length - 1];
    const changePercent =
      list.length > 1 && first !== 0 ? Math.round(((last - first) / Math.abs(first)) * 1000) / 10 : null;
    const known = METRICS.find((m) => m.name === list[0].metric);
    const improved =
      changePercent === null || changePercent === 0 || !known ? null : known.higherIsBetter === changePercent > 0;
    return {
      key,
      metric: list[0].metric,
      unit: list[0].unit,
      scene: list[0].scene,
      gpu: list[0].gpu,
      values,
      latest: list[list.length - 1],
      changePercent,
      improved,
    };
  });
}
