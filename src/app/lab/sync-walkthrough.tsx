"use client";

import { useEffect, useState } from "react";
import { LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { viewById } from "@/lib/lab/guide";
import { SYNC_STEP_X, SyncLanes } from "./figures-host";

// Steps through the command buffer one command at a time: a band slides to each
// barrier, and the caption says what it orders and whether it sits on the chain
// that the acquire semaphore starts. Step 0 shows the whole figure.

const CHAIN: { on: boolean | null; note: string }[] = [
  {
    on: true,
    note: "Starts the chain. Work at the compute-shader stage, and anything chained after it, waits until the display lets go of the image.",
  },
  {
    on: null,
    note: "Not about the swapchain image. Orders this frame's shader writes after last frame's copy read storageImage.",
  },
  {
    on: null,
    note: "Not about the swapchain image. Orders this frame's reads and writes of accumImage after last frame's.",
  },
  { on: true, note: "On the chain: its compute-shader stage is what the semaphore holds back." },
  {
    on: true,
    note: "On the chain: its source stage, COMPUTE_SHADER, matches the dispatch, so the chain carries on to the copy.",
  },
  {
    on: false,
    note: "Off the chain. Its source stage, TOP_OF_PIPE, waits for nothing, so the layout transition can write the image while the display still reads it. This is the hazard the validation layer reports.",
  },
  { on: true, note: "On the chain, through the storageImage barrier before it, so the copy itself waits correctly." },
  { on: true, note: "On the chain. The submit then signals renderFinished, and present waits on that." },
];

export function SyncWalkthrough() {
  const steps = viewById("sync")!.steps;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(
      () => {
        if (step >= steps.length) setPlaying(false);
        else setStep(step + 1);
      },
      step === 0 ? 300 : 2600,
    );
    return () => window.clearTimeout(t);
  }, [playing, step, steps.length]);

  const current = step > 0 ? steps[step - 1] : null;
  const chain = step > 0 ? CHAIN[step - 1] : null;
  const x = step > 0 ? SYNC_STEP_X[step - 1] : SYNC_STEP_X[0];
  const problem = chain?.on === false;

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div className="space-y-4">
          <SyncLanes>
            <m.rect
              y={28}
              width={84}
              height={334}
              rx={10}
              initial={false}
              animate={{ x: x - 42, opacity: step > 0 ? 1 : 0 }}
              transition={{ type: "spring", stiffness: 160, damping: 22 }}
              className={problem ? "fill-coral/10 stroke-coral" : "fill-white/5 stroke-white/50"}
              strokeWidth={1.5}
              pointerEvents="none"
            />
          </SyncLanes>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              className="btn-primary px-4 py-1.5"
              onClick={() =>
                playing ? setPlaying(false) : (setStep(step >= steps.length ? 0 : step), setPlaying(true))
              }
            >
              {playing ? "Pause" : step >= steps.length ? "Replay" : "Walk through it"}
            </button>
            <button
              type="button"
              className="btn-ghost px-3 py-1.5"
              onClick={() => {
                setPlaying(false);
                setStep(Math.max(0, step - 1));
              }}
              disabled={step === 0}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-ghost px-3 py-1.5"
              onClick={() => {
                setPlaying(false);
                setStep(Math.min(steps.length, step + 1));
              }}
              disabled={step >= steps.length}
            >
              Next
            </button>
            <ol className="ml-1 flex flex-wrap gap-1" aria-label="Steps">
              {steps.map((s, i) => (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      setStep(i + 1);
                    }}
                    aria-current={step === i + 1 ? "step" : undefined}
                    aria-label={`Step ${i + 1}: ${s.title}`}
                    className={`size-7 cursor-pointer rounded-full text-xs tabular-nums ring-1 ${step === i + 1 ? (CHAIN[i].on === false ? "bg-coral/20 text-coral ring-coral" : "bg-white/15 text-white ring-white/50") : "text-neutral-400 ring-white/15 hover:text-white"}`}
                  >
                    {i + 1}
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div
            aria-live="polite"
            className={`min-h-24 rounded-xl p-4 ring-1 ${problem ? "bg-coral/5 ring-coral/30" : "bg-white/5 ring-white/10"}`}
          >
            {current && chain ? (
              <m.div
                key={step}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-1.5"
              >
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-neutral-400 tabular-nums">
                    Step {step} of {steps.length}
                  </span>
                  <span className="font-semibold">{current.title}</span>
                  {chain.on === true && <span className="chip bg-aqua/10 text-aqua ring-aqua/30">on the chain</span>}
                  {chain.on === false && (
                    <span className="chip bg-coral/10 text-coral ring-coral/30">off the chain</span>
                  )}
                </p>
                <p className="text-sm text-neutral-300">{current.text}</p>
                <p className="text-sm text-neutral-400">{chain.note}</p>
              </m.div>
            ) : (
              <p className="text-sm text-neutral-300">
                The aqua line is the chain the acquire semaphore starts: anything on it waits until the display has let
                go of the image. Walk through the eight commands to see which barriers join it, and the one that does
                not.
              </p>
            )}
          </div>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
