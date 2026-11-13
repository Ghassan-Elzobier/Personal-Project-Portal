// How each exercise looks: a two-frame drawing that loops between the start and
// end of the movement, and a link to short demonstration videos.
//
// The drawings are Everkinetic's (github.com/everkinetic/data), licensed CC BY-SA
// 4.0, copied unchanged into public/exercises as <key>-1.png (start) and
// <key>-2.png (end); the credit shows under each one. Exercises Everkinetic never
// drew (jumps, throws, carries, the trap bar) have the video link only: there is
// no openly licensed drawing of them, and photos of unclear origin stay out of
// this public repo. Pure data.

import type { Exercise } from "./program.ts";

/** Exercises with a drawing, and the drawing they use when it is shared. */
const DRAWN: Record<string, string> = {
  bench: "bench",
  "paused-bench": "bench",
  "close-grip-bench": "close-grip-bench",
  "db-bench": "db-bench",
  "incline-db": "incline-db",
  "back-squat": "back-squat",
  "front-squat": "front-squat",
  "leg-press": "leg-press",
  "reverse-lunge": "reverse-lunge",
  "ham-curl": "ham-curl",
  "leg-extension": "leg-extension",
  "cable-fly": "cable-fly",
  "db-fly": "db-fly",
  dips: "dips",
  "close-grip-pushup": "close-grip-pushup",
  "cable-row": "cable-row",
  "pull-up": "pull-up",
  "seated-db-press": "seated-db-press",
  "lateral-raise": "lateral-raise",
  curl: "curl",
  pushdown: "pushdown",
  "lying-triceps-ext": "lying-triceps-ext",
  "side-plank": "side-plank",
  "ab-wheel": "ab-wheel",
  "cable-crunch": "cable-crunch",
};

export const DRAWING_CREDIT = {
  by: "Everkinetic",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  source: "https://github.com/everkinetic/data",
};

export type Demo = {
  /** Start and end of the movement, or null when there is no drawing. */
  frames: [string, string] | null;
  /** YouTube search for short videos (under 4 minutes) of the exercise. */
  video: string;
};

export function demoFor(ex: Pick<Exercise, "key" | "name">): Demo {
  const drawn = DRAWN[ex.key];
  return {
    frames: drawn ? [`/exercises/${drawn}-1.png`, `/exercises/${drawn}-2.png`] : null,
    video: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${ex.name} how to do it`)}&sp=EgIYAQ%3D%3D`,
  };
}

/** The drawing files a demo needs, for the test that checks they exist. */
export function drawingFiles(): string[] {
  return [...new Set(Object.values(DRAWN))].flatMap((k) => [`${k}-1.png`, `${k}-2.png`]);
}
