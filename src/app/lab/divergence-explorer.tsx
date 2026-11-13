"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { LAMBERTIAN, MAX_BOUNCES, runSubgroup, tracePixel } from "@/lib/lab/pathtracer";
import { Badge, TONES } from "./kit";

// Pick a pixel and see its subgroup work through the bounce loop: one column per
// lane, one row per trip. It runs pathtracer.ts, the shader's own logic, in the
// browser. The preview is every second pixel of frame 0. Play walks the loop one
// trip at a time, so you can watch lanes finish and wait.

const W = 800;
const H = 600;
const STEP = 2;
const PW = W / STEP;
const PH = H / STEP;
const SIZES = [8, 16, 32, 64] as const;
type Size = (typeof SIZES)[number];

// One trip to eight, dark to bright, in the portal's colours.
const RAMP = ["#2a3060", "#1d6f86", "#33c2cc", "#57db96", "#d6995c", "#cc6033", "#ca2f8c", "#ea4884"];

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

export function DivergenceExplorer() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<{
    color: Uint8ClampedArray<ArrayBuffer>;
    trips: Uint8ClampedArray<ArrayBuffer>;
    rows: number;
  } | null>(null);
  const [pick, setPick] = useState({ x: 400, y: 300 });
  const [size, setSize] = useState<Size>(16);
  const [mode, setMode] = useState<"trips" | "picture">("trips");
  const [progress, setProgress] = useState(0);
  // Trips shown so far. All of them unless the walkthrough is running.
  const [shown, setShown] = useState(MAX_BOUNCES);
  const [playing, setPlaying] = useState(false);

  // Trace the preview a few rows at a time, so the page stays responsive.
  useEffect(() => {
    const color = new Uint8ClampedArray(PW * PH * 4);
    const trips = new Uint8ClampedArray(PW * PH * 4);
    preview.current = { color, trips, rows: 0 };
    let row = 0;
    let handle = 0;
    const work = () => {
      const until = performance.now() + 12;
      while (row < PH && performance.now() < until) {
        for (let i = 0; i < PW; i++) {
          const p = tracePixel(i * STEP, row * STEP, W, H, 0);
          const o = (row * PW + i) * 4;
          color.set([Math.sqrt(p.color[0]) * 255, Math.sqrt(p.color[1]) * 255, Math.sqrt(p.color[2]) * 255, 255], o);
          trips.set([...hex(RAMP[p.iterations - 1]), 255], o);
        }
        row++;
      }
      preview.current!.rows = row;
      setProgress(row / PH);
      if (row < PH) handle = window.setTimeout(work, 0);
    };
    handle = window.setTimeout(work, 0);
    return () => window.clearTimeout(handle);
  }, []);

  const run = useMemo(() => runSubgroup(pick.x, pick.y, size, W, H, 0), [pick, size]);

  // A new subgroup starts fully shown.
  useEffect(() => {
    setPlaying(false);
    setShown(MAX_BOUNCES);
  }, [run]);

  useEffect(() => {
    if (!playing) return;
    if (shown >= run.trips) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setShown((s) => s + 1), shown === 0 ? 250 : 900);
    return () => window.clearTimeout(t);
  }, [playing, shown, run.trips]);

  // Redraw the preview with the chosen subgroup outlined.
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    const data = preview.current;
    if (!ctx || !data) return;
    ctx.putImageData(new ImageData(mode === "trips" ? data.trips : data.color, PW, PH), 0, 0);
    const xs = run.lanes.map((l) => l.x);
    const ys = run.lanes.map((l) => l.y);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    const x0 = Math.min(...xs) / STEP;
    const y0 = Math.min(...ys) / STEP;
    ctx.strokeRect(
      x0 - 1.5,
      y0 - 1.5,
      (Math.max(...xs) - Math.min(...xs) + 1) / STEP + 3,
      (Math.max(...ys) - Math.min(...ys) + 1) / STEP + 3,
    );
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.strokeRect(
      x0 - 5.5,
      y0 - 5.5,
      (Math.max(...xs) - Math.min(...xs) + 1) / STEP + 11,
      (Math.max(...ys) - Math.min(...ys) + 1) / STEP + 11,
    );
  }, [run, mode, progress]);

  const choose = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(W - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * H)));
    setPick({ x, y });
  };
  const nudge = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-8, 0],
      ArrowRight: [8, 0],
      ArrowUp: [0, -8],
      ArrowDown: [0, 8],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setPick((p) => ({ x: Math.min(W - 1, Math.max(0, p.x + m[0])), y: Math.min(H - 1, Math.max(0, p.y + m[1])) }));
  };

  const work = run.lanes.reduce((s, l) => s + (l.path?.iterations ?? 0), 0);
  const upTo = Math.min(shown, run.trips);
  const workSoFar = run.lanes.reduce((s, l) => s + Math.min(upTo, l.path?.iterations ?? 0), 0);
  const walking = shown < MAX_BOUNCES || playing;
  const cell = Math.min(40, 560 / size);
  const gridW = cell * size;
  const top = 34;
  const rowH = 26;

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <div role="group" aria-label="Subgroup size" className="flex items-center gap-1">
              <span className="mr-1 text-muted">Subgroup</span>
              {SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  aria-pressed={size === s}
                  className={`chip cursor-pointer px-3 py-1 ${size === s ? "bg-aqua/15 text-aqua ring-aqua/50" : "bg-white/5 text-body ring-white/10 hover:bg-white/10"}`}
                >
                  {s}
                </button>
              ))}
              <span className="ml-1 text-xs text-muted">16: the Iris Xe. 64: the RX 5700 XT on Linux</span>
            </div>
            <div role="group" aria-label="Preview" className="flex items-center gap-1">
              <span className="mr-1 text-muted">Show</span>
              {(["trips", "picture"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMode(option)}
                  aria-pressed={mode === option}
                  className={`chip cursor-pointer px-3 py-1 ${mode === option ? "bg-lavender/20 text-white ring-lavender" : "bg-white/5 text-body ring-white/10 hover:bg-white/10"}`}
                >
                  {option === "trips" ? "Trips per path" : "The picture"}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Walk through the loop" className="flex items-center gap-1">
              <button
                type="button"
                className="btn-primary px-4 py-1"
                onClick={() =>
                  playing ? setPlaying(false) : (setShown(shown >= run.trips ? 0 : shown), setPlaying(true))
                }
              >
                {playing ? "Pause" : shown > 0 && shown < run.trips ? "Continue" : "Play the loop"}
              </button>
              <button
                type="button"
                className="btn-ghost px-3 py-1"
                onClick={() => {
                  setPlaying(false);
                  setShown((s) => (s >= run.trips ? 1 : s + 1));
                }}
              >
                Step
              </button>
              <button
                type="button"
                className="btn-ghost px-3 py-1"
                onClick={() => {
                  setPlaying(false);
                  setShown(MAX_BOUNCES);
                }}
                disabled={shown >= MAX_BOUNCES}
              >
                Show all
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
            <div className="space-y-2">
              <div className="relative">
                <canvas
                  ref={canvas}
                  width={PW}
                  height={PH}
                  tabIndex={0}
                  onPointerDown={choose}
                  onKeyDown={nudge}
                  aria-label={`Frame 0 of the renderer, every second pixel. Selected pixel ${pick.x}, ${pick.y}. Click a pixel, or use the arrow keys, to pick a subgroup.`}
                  className="w-full cursor-crosshair rounded-lg ring-1 ring-white/10 [image-rendering:pixelated]"
                />
                <span className="pointer-events-none absolute top-1 left-1">
                  <svg width="28" height="28" aria-hidden>
                    <Badge n={1} x={14} y={14} tone="shader" />
                  </svg>
                </span>
                {progress < 1 && (
                  <span className="absolute right-2 bottom-2 rounded-sm bg-primary/80 px-2 py-0.5 text-xs text-body">
                    Tracing {Math.round(progress * 100)}%
                  </span>
                )}
              </div>
              {mode === "trips" ? (
                <div
                  className="flex flex-wrap items-center gap-1 text-xs text-muted"
                  aria-label="Trips per path, 1 to 8"
                >
                  <span className="mr-1">Trips:</span>
                  {RAMP.map((c, i) => (
                    <span key={c} className="flex items-center gap-1 pr-1">
                      <span className="inline-block size-3 rounded-sm" style={{ background: c }} />
                      {i + 1}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">One sample per pixel, as frame 0 shows it before any averaging.</p>
              )}
              <p className="text-xs text-muted">
                Pixel ({pick.x}, {pick.y}), workgroup ({Math.floor(pick.x / 8)}, {Math.floor(pick.y / 8)}). Arrow keys
                move one tile.
              </p>
            </div>

            <div className="min-w-0 space-y-3">
              <div className="overflow-x-auto">
                <svg
                  viewBox={`0 0 ${gridW + 150} ${top + MAX_BOUNCES * rowH + 30}`}
                  className="h-auto w-full"
                  style={{ minWidth: 480 }}
                  role="img"
                  aria-label={`The subgroup ran ${run.trips} trips. Lanes did work on ${work} of ${size * run.trips} lane-trips, ${Math.round(run.efficiency * 100)}% SIMD efficiency.`}
                >
                  <text x={0} y={14} className="fill-muted text-2xs">
                    lanes →
                  </text>
                  {size <= 16 &&
                    run.lanes.map((l) => (
                      <text
                        key={l.lane}
                        x={l.lane * cell + cell / 2}
                        y={28}
                        textAnchor="middle"
                        className="fill-faint text-3xs tabular-nums"
                      >
                        {l.lane}
                      </text>
                    ))}
                  {Array.from({ length: MAX_BOUNCES }, (_, k) => {
                    const y = top + k * rowH;
                    const t = run.perTrip[k];
                    return (
                      <g key={k}>
                        {run.lanes.map((l) => {
                          const p = l.path;
                          const active = p && p.iterations > k;
                          const hit = p?.hits[k];
                          const fill = !p
                            ? "fill-white/5"
                            : !active
                              ? "fill-none"
                              : hit
                                ? hit.material === LAMBERTIAN
                                  ? "fill-aqua/70"
                                  : "fill-lavender"
                                : "fill-mint/80";
                          return (
                            <m.rect
                              key={l.lane}
                              x={l.lane * cell + 1}
                              y={y + 2}
                              width={cell - 2}
                              height={rowH - 4}
                              rx={Math.min(4, cell / 4)}
                              className={`${fill} ${active ? "" : "stroke-white/10"}`}
                              strokeWidth={1}
                              initial={false}
                              animate={{ opacity: k < shown ? 1 : 0.06 }}
                              transition={{
                                duration: 0.3,
                                delay: playing && k === shown - 1 ? l.lane * (0.25 / size) : 0,
                              }}
                            />
                          );
                        })}
                        <text
                          x={gridW + 8}
                          y={y + 17}
                          opacity={k < shown ? 1 : 0.35}
                          className={`text-2xs tabular-nums ${t ? "fill-body" : "fill-neutral-600"}`}
                        >
                          {t ? `trip ${k + 1}: ${t.active}/${size}` : `trip ${k + 1}`}
                        </text>
                        {t?.both && k < shown && (
                          <text x={gridW + 88} y={y + 17} className="fill-coral text-2xs font-semibold">
                            both
                          </text>
                        )}
                      </g>
                    );
                  })}
                  <m.g
                    initial={false}
                    animate={{ opacity: run.trips > 0 && shown >= run.trips ? 1 : 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <line
                      x1={0}
                      x2={gridW}
                      y1={top + run.trips * rowH}
                      y2={top + run.trips * rowH}
                      className="stroke-white"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  </m.g>
                  <text x={0} y={top + MAX_BOUNCES * rowH + 20} className="fill-muted text-2xs">
                    Dashed line: where the subgroup leaves the loop, with its slowest lane.
                  </text>
                  {walking && shown < run.trips && (
                    <m.rect
                      x={-2}
                      width={gridW + 4}
                      height={rowH}
                      rx={6}
                      initial={false}
                      animate={{ y: top + Math.max(0, shown - 1) * rowH, opacity: shown > 0 ? 1 : 0 }}
                      transition={{ type: "spring", stiffness: 200, damping: 26 }}
                      className="fill-none stroke-white/60"
                      strokeWidth={1.5}
                    />
                  )}
                  <Badge n={2} x={gridW + 136} y={12} tone="shader" />
                  {run.trips > 0 && <Badge n={3} x={gridW - 4} y={top + run.trips * rowH} tone="plain" />}
                  {run.perTrip.some((t) => t.both) && (
                    <Badge
                      n={4}
                      x={gridW + 128}
                      y={top + run.perTrip.findIndex((t) => t.both) * rowH + 12}
                      tone="problem"
                    />
                  )}
                </svg>
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-body" aria-label="Cell key">
                <li className="flex items-center gap-1.5">
                  <span className="size-3 rounded-sm bg-aqua/70" />
                  hit diffuse
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-3 rounded-sm bg-lavender" />
                  hit metal
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-3 rounded-sm bg-mint/80" />
                  escaped to the sky
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-3 rounded-sm ring-1 ring-white/20" />
                  finished, waiting
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="font-semibold text-coral">both</span>both material branches ran
                </li>
              </ul>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="flex items-center gap-2">
                  <svg width="24" height="24" aria-hidden>
                    <Badge n={6} x={12} y={12} tone="shader" />
                  </svg>
                  <span className="text-3xl font-bold tabular-nums" style={{ color: TONES.shader.hex }}>
                    {Math.round(run.efficiency * 100)}%
                  </span>
                  <span className="text-sm text-body">SIMD efficiency for this subgroup</span>
                </p>
                <p className="text-sm text-muted tabular-nums">
                  {work} of {size * run.trips} lane-trips did work, over {run.trips}{" "}
                  {run.trips === 1 ? "trip" : "trips"}
                </p>
              </div>
              {walking && upTo > 0 && (
                <p aria-live="polite" className="text-sm text-body tabular-nums">
                  After trip {upTo}: {run.perTrip[upTo - 1].active} of {size} lanes still working; {workSoFar} of{" "}
                  {size * upTo} lane-trips so far did work ({Math.round((workSoFar / (size * upTo)) * 100)}%).
                </p>
              )}
              <p className="flex items-start gap-2 text-xs text-muted">
                <svg width="22" height="22" className="shrink-0" aria-hidden>
                  <Badge n={5} x={11} y={11} tone="shader" />
                </svg>
                Inside each trip, the 16-try loop in randomUnitVector ends at different times per lane too, so the same
                waiting happens at a smaller scale.
              </p>
            </div>
          </div>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
