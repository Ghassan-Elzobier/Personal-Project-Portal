// A three-day full-body programme for athletic strength, built around the bench.
//
// Why this shape:
// - Full body three times a week trains each muscle about three times, and once
//   weekly volume is matched, how it is spread matters little (Schoenfeld et al.
//   2016, 2019). Three sessions suit a working week.
// - The bench is a skill as well as strength, so it is practised every session in
//   three flavours: heavy, paused and close-grip. Each session's main lift has a
//   rep range and a target of reps in reserve, which keeps sets hard but not to
//   failure (Helms et al. 2016 on RIR-based loading).
// - Power comes first while you are fresh: low-rep jumps and throws with full
//   intent improve jumping and sprinting more than lifting alone (Markovic 2007
//   on plyometrics), and med ball chest passes carry over to pressing speed.
// - Lower back friendly: the main lower-body lifts keep the torso upright (front
//   or goblet squat, split squats) or the load close (trap bar), hinges stay
//   submaximal, and every warm-up has McGill's "big three" for trunk endurance.
// - Short conditioning at the end keeps you fit without eating into the surplus.
//
// Every exercise lists alternatives, so a missing trap bar or sled never stops a
// session. Pure data.

export type Equipment = "barbell" | "rack" | "bench" | "dumbbells" | "cable" | "box" | "med-ball" | "trap-bar" | "pull-up-bar" | "bike" | "rower" | "sled" | "landmine" | "leg-press" | "ham-curl" | "back-extension" | "kettlebell";

export type Load = "barbell" | "dumbbell" | "machine" | "bodyweight" | "ball" | "time" | "distance";

export type Exercise = {
  key: string;
  name: string;
  equipment: Equipment[];
  load: Load;
  /** Weight added when you earn it. Dumbbells usually go up in 2 kg steps. */
  step: number;
  perSide?: boolean;
  cues: string[];
  /** Why it suits a sensitive lower back, or how to keep it that way. */
  back?: string;
  /** In order of preference when the gym lacks something. */
  alts: string[];
  /** Where to start the first time, as a share of a bench press set of 5 or a fixed note. */
  start?: string;
};

export const EXERCISES: Exercise[] = [
  // Power
  { key: "box-jump", name: "Box jump", equipment: ["box"], load: "bodyweight", step: 0, cues: ["Swing the arms and jump as high as you can, not just onto the box", "Land softly in a quarter squat", "Step down, never jump down"], alts: ["squat-jump"] },
  { key: "squat-jump", name: "Squat jump", equipment: [], load: "bodyweight", step: 0, cues: ["Dip to a quarter squat and explode up", "Reset fully between reps"], alts: [] },
  { key: "broad-jump", name: "Broad jump", equipment: [], load: "bodyweight", step: 0, cues: ["Jump as far forward as you can", "Stick the landing for a second", "Walk back and reset"], alts: ["squat-jump"] },
  { key: "lateral-bound", name: "Lateral bound", equipment: [], load: "bodyweight", step: 0, perSide: true, cues: ["Push off one leg sideways", "Land on the other and hold for 2 seconds"], alts: [] },
  { key: "mb-chest-pass", name: "Med ball chest pass", equipment: ["med-ball"], load: "ball", step: 0, cues: ["Stand an arm's length from a wall", "Throw as hard as you can from the chest, like a fast bench", "Catch, reset, repeat"], alts: ["plyo-pushup"] },
  { key: "plyo-pushup", name: "Explosive push-up", equipment: [], load: "bodyweight", step: 0, cues: ["Lower under control, push so hard your hands leave the floor"], alts: [] },
  { key: "mb-scoop-toss", name: "Med ball rotational throw", equipment: ["med-ball"], load: "ball", step: 0, perSide: true, cues: ["Side-on to a wall", "Load the back hip and turn it through hard", "The power comes from the hips, not the arms"], back: "Turn from the hips, keeping the ribs stacked over the pelvis.", alts: ["cable-woodchop"] },

  // Bench
  { key: "bench", name: "Bench press", equipment: ["barbell", "bench", "rack"], load: "barbell", step: 2.5, cues: ["Shoulder blades squeezed back and down, feet planted", "Bar to the lower chest, elbows about 45° from the body", "Drive up and slightly back towards the rack"], alts: ["db-bench"], start: "Build up in sets of 5 from the empty bar until it feels like 3 left in the tank." },
  { key: "paused-bench", name: "Paused bench press", equipment: ["barbell", "bench", "rack"], load: "barbell", step: 2.5, cues: ["Lower to the chest and hold still for a full second", "Stay tight through the pause, then press hard"], alts: ["db-bench"], start: "About 85% of your bench set-of-5 weight." },
  { key: "close-grip-bench", name: "Close-grip bench press", equipment: ["barbell", "bench", "rack"], load: "barbell", step: 2.5, cues: ["Hands just inside shoulder width", "Elbows tucked; feel it in the triceps"], alts: ["db-bench"], start: "About 85% of your bench set-of-5 weight." },
  { key: "db-bench", name: "Dumbbell bench press", equipment: ["dumbbells", "bench"], load: "dumbbell", step: 2, cues: ["Full range: stretch at the bottom", "Press up and slightly in"], alts: [] },
  { key: "incline-db", name: "Incline dumbbell press", equipment: ["dumbbells", "bench"], load: "dumbbell", step: 2, cues: ["Bench at 30°", "Upper chest and shoulders: the 'athletic' look"], alts: ["db-bench"] },

  // Lower body
  { key: "front-squat", name: "Front squat", equipment: ["barbell", "rack"], load: "barbell", step: 2.5, cues: ["Elbows high, bar on the shoulders", "Sit straight down between the heels", "Brace before each rep"], back: "Upright torso, so far less load on the lower back than a back squat.", alts: ["goblet-squat", "leg-press"], start: "Start with the empty bar to learn the rack position." },
  { key: "goblet-squat", name: "Goblet squat", equipment: ["dumbbells"], load: "dumbbell", step: 2, cues: ["Dumbbell held at the chest", "Elbows inside the knees at the bottom"], back: "Front-loaded and upright, the friendliest squat for a sensitive back.", alts: [] },
  { key: "leg-press", name: "Leg press", equipment: ["leg-press"], load: "machine", step: 5, cues: ["Lower until the hips are about to tuck, no further", "Lower back stays on the pad"], back: "Keep the lower back on the pad: the range stops before the hips curl up.", alts: ["goblet-squat"] },
  { key: "trap-bar-deadlift", name: "Trap bar deadlift", equipment: ["trap-bar"], load: "barbell", step: 5, cues: ["Stand in the middle, hips back, chest up", "Push the floor away", "Stand tall at the top, no leaning back"], back: "The load sits in line with you, so the back works far less than in a straight-bar deadlift. Stop every set with 2 or more reps left.", alts: ["db-rdl", "hip-thrust"], start: "Start at 60 kg or lighter and build up." },
  { key: "db-rdl", name: "Dumbbell Romanian deadlift", equipment: ["dumbbells"], load: "dumbbell", step: 2, cues: ["Soft knees, push the hips back", "Dumbbells slide down the thighs", "Stop when the hamstrings are tight and the back is still flat"], back: "Only go as low as you can keep a flat back.", alts: ["hip-thrust"] },
  { key: "hip-thrust", name: "Barbell hip thrust", equipment: ["barbell", "bench"], load: "barbell", step: 5, cues: ["Upper back on the bench, bar over the hips with a pad", "Chin tucked, drive through the heels", "Squeeze at the top, ribs down"], back: "Strong hips without loading the spine. Don't arch at the top.", alts: ["glute-bridge"] },
  { key: "glute-bridge", name: "Dumbbell glute bridge", equipment: ["dumbbells"], load: "dumbbell", step: 2, cues: ["Back on the floor, drive the hips up and squeeze"], alts: [] },
  { key: "split-squat", name: "Bulgarian split squat", equipment: ["dumbbells", "bench"], load: "dumbbell", step: 2, perSide: true, cues: ["Back foot on the bench", "Front shin fairly vertical, drop the back knee", "Push through the front foot"], back: "Single leg means heavy legs with light spinal load.", alts: ["reverse-lunge"] },
  { key: "reverse-lunge", name: "Dumbbell reverse lunge", equipment: ["dumbbells"], load: "dumbbell", step: 2, perSide: true, cues: ["Step back, drop the knee, drive back up"], alts: [] },
  { key: "ham-curl", name: "Lying hamstring curl", equipment: ["ham-curl"], load: "machine", step: 2.5, cues: ["Hips pressed into the pad", "Lower slowly, 3 seconds"], alts: ["nordic"] },
  { key: "nordic", name: "Assisted Nordic curl", equipment: [], load: "bodyweight", step: 0, cues: ["Knees on a pad, heels anchored", "Lower as slowly as you can, push back up with the hands"], alts: [] },

  // Upper back and arms
  { key: "chest-row", name: "Chest-supported dumbbell row", equipment: ["dumbbells", "bench"], load: "dumbbell", step: 2, cues: ["Chest on a 30° bench", "Pull the elbows to the hips", "Pause at the top"], back: "The bench takes the load off the lower back.", alts: ["cable-row"] },
  { key: "cable-row", name: "Seated cable row", equipment: ["cable"], load: "machine", step: 2.5, cues: ["Sit tall, pull to the stomach", "Shoulders down, squeeze the shoulder blades"], alts: ["chest-row"] },
  { key: "one-arm-row", name: "One-arm dumbbell row", equipment: ["dumbbells", "bench"], load: "dumbbell", step: 2, perSide: true, cues: ["Hand and knee on the bench, back flat", "Pull to the hip"], alts: ["cable-row"] },
  { key: "pull-up", name: "Pull-up", equipment: ["pull-up-bar"], load: "bodyweight", step: 2.5, cues: ["Full hang to chin over the bar", "Add weight with a belt once you get 10 reps"], alts: ["lat-pulldown"] },
  { key: "lat-pulldown", name: "Lat pulldown", equipment: ["cable"], load: "machine", step: 2.5, cues: ["Pull the bar to the top of the chest", "Lead with the elbows"], alts: [] },
  { key: "landmine-press", name: "Half-kneeling landmine press", equipment: ["landmine", "barbell"], load: "barbell", step: 2.5, perSide: true, cues: ["One knee down, squeeze that glute", "Press up and forward, reach at the top"], back: "Kneeling with the glute squeezed stops you arching, unlike a standing overhead press.", alts: ["seated-db-press"], start: "Start with the empty bar plus 5 kg." },
  { key: "seated-db-press", name: "Seated dumbbell shoulder press", equipment: ["dumbbells", "bench"], load: "dumbbell", step: 2, cues: ["Back supported, slight incline", "Press up, don't arch"], back: "Back supported on the bench.", alts: [] },
  { key: "lateral-raise", name: "Lateral raise", equipment: ["dumbbells"], load: "dumbbell", step: 1, cues: ["Lead with the elbows, raise to shoulder height", "Slow on the way down"], alts: [] },
  { key: "face-pull", name: "Cable face pull", equipment: ["cable"], load: "machine", step: 2.5, cues: ["Rope at face height, pull to the eyes", "Thumbs back at the end"], alts: ["lateral-raise"] },
  { key: "curl", name: "Dumbbell curl", equipment: ["dumbbells"], load: "dumbbell", step: 1, cues: ["Elbows still, full range"], alts: [] },
  { key: "pushdown", name: "Triceps rope pushdown", equipment: ["cable"], load: "machine", step: 2.5, cues: ["Elbows pinned to the sides", "Spread the rope at the bottom"], alts: ["db-skull"] },
  { key: "db-skull", name: "Dumbbell overhead triceps extension", equipment: ["dumbbells"], load: "dumbbell", step: 2, cues: ["Seated, elbows pointing up", "Lower behind the head, press up"], alts: [] },

  // Core and carries
  { key: "pallof", name: "Pallof press", equipment: ["cable"], load: "machine", step: 2.5, perSide: true, cues: ["Side-on to the cable", "Press the handle straight out and resist the twist"], back: "Anti-rotation: trains the trunk to stay still, which is what protects a back.", alts: ["side-plank"] },
  { key: "side-plank", name: "Side plank", equipment: [], load: "time", step: 0, perSide: true, cues: ["Straight line from head to feet"], alts: [] },
  { key: "farmer-carry", name: "Farmer's carry", equipment: ["dumbbells"], load: "dumbbell", step: 2, cues: ["Heaviest dumbbells you can hold for 30 m", "Walk tall, short quick steps"], back: "Loads the trunk standing tall: one of the best back-friendly core drills.", alts: ["suitcase-carry"] },
  { key: "suitcase-carry", name: "Suitcase carry", equipment: ["dumbbells"], load: "dumbbell", step: 2, perSide: true, cues: ["One heavy dumbbell, don't lean"], alts: [] },
  { key: "back-extension", name: "45° back extension", equipment: ["back-extension"], load: "bodyweight", step: 0, cues: ["Hinge at the hips, not the lower back", "Squeeze the glutes to come up; stop level with the body"], back: "Light, high-rep endurance. Skip it on any day the back complains.", alts: ["bird-dog"] },
  { key: "bird-dog", name: "Bird dog", equipment: [], load: "time", step: 0, perSide: true, cues: ["Opposite arm and leg out, hold 8 seconds"], alts: [] },
  { key: "cable-woodchop", name: "Cable woodchop", equipment: ["cable"], load: "machine", step: 2.5, perSide: true, cues: ["Turn from the hips, arms just guide the handle"], alts: [] },

  // Conditioning
  { key: "bike-sprint", name: "Bike sprints", equipment: ["bike"], load: "time", step: 0, cues: ["10 seconds flat out, 50 seconds easy", "Resistance high enough that you can't spin out"], alts: ["rower-intervals"] },
  { key: "rower-intervals", name: "Rower intervals", equipment: ["rower"], load: "distance", step: 0, cues: ["Legs, then body, then arms", "250 m hard, 90 seconds easy"], alts: ["bike-sprint"] },
  { key: "sled-push", name: "Sled push", equipment: ["sled"], load: "machine", step: 10, cues: ["Low body angle, drive with short steps"], alts: ["farmer-carry"] },
];

export const EXERCISE_MAP = new Map(EXERCISES.map((e) => [e.key, e]));

export type Scheme =
  /** One heavy set in the range, then back-off sets at 90% of it. */
  | "top-backoff"
  /** Same weight for every set; add weight when all hit the top of the range. */
  | "straight"
  /** Few reps at full speed; quality, not load. */
  | "power"
  /** Seconds or metres, not reps. */
  | "timed";

export type Prescription = {
  exercise: string;
  sets: number;
  reps: [number, number];
  /** Reps you should still have in the tank. */
  rir: number;
  rest: number;
  scheme: Scheme;
  /** Shown on the card, e.g. "6 × 10 s". */
  note?: string;
};

export type Block = { title: string; items: Prescription[]; superset?: boolean };

export type Workout = {
  key: "A" | "B" | "C";
  name: string;
  focus: string;
  warmup: string[];
  blocks: Block[];
};

const WARMUP = [
  "5 minutes easy on the bike or rower",
  "McGill big three: 5 curl-ups, 2 × 10 s side planks a side, 5 bird dogs a side",
  "10 bodyweight squats, 10 band pull-aparts or arm circles",
];

export const PROGRAM: { key: string; name: string; summary: string; workouts: Workout[] } = {
  key: "athletic-3",
  name: "Athletic full body, 3 days",
  summary: "Power first, then the bench in three flavours, a back-friendly lower-body lift, upper back and arms, and a short finisher. About 75 minutes.",
  workouts: [
    {
      key: "A",
      name: "Heavy bench and squat",
      focus: "Top-end bench strength and an upright squat.",
      warmup: [...WARMUP, "Bench warm-up sets: bar × 10, then 3 to 4 sets of 3 to 5 building to your top set"],
      blocks: [
        { title: "Power", items: [
          { exercise: "box-jump", sets: 3, reps: [3, 3], rir: 3, rest: 60, scheme: "power" },
          { exercise: "mb-chest-pass", sets: 3, reps: [5, 5], rir: 3, rest: 60, scheme: "power" },
        ] },
        { title: "Strength", items: [
          { exercise: "bench", sets: 4, reps: [4, 6], rir: 2, rest: 180, scheme: "top-backoff", note: "1 top set of 4 to 6, then 3 × 5 at 90%" },
          { exercise: "front-squat", sets: 3, reps: [5, 6], rir: 2, rest: 150, scheme: "straight" },
        ] },
        { title: "Build", superset: true, items: [
          { exercise: "chest-row", sets: 3, reps: [8, 10], rir: 1, rest: 75, scheme: "straight" },
          { exercise: "lateral-raise", sets: 3, reps: [12, 15], rir: 1, rest: 45, scheme: "straight" },
        ] },
        { title: "Core and finisher", items: [
          { exercise: "pallof", sets: 3, reps: [10, 10], rir: 2, rest: 45, scheme: "straight" },
          { exercise: "bike-sprint", sets: 6, reps: [10, 10], rir: 0, rest: 50, scheme: "timed", note: "6 × 10 s flat out, 50 s easy" },
        ] },
      ],
    },
    {
      key: "B",
      name: "Hinge, pull and paused bench",
      focus: "Hips and back, plus bench strength off the chest.",
      warmup: [...WARMUP, "Trap bar warm-up: 3 sets of 3 building up"],
      blocks: [
        { title: "Power", items: [
          { exercise: "broad-jump", sets: 3, reps: [3, 3], rir: 3, rest: 60, scheme: "power" },
          { exercise: "mb-scoop-toss", sets: 3, reps: [4, 4], rir: 3, rest: 45, scheme: "power" },
        ] },
        { title: "Strength", items: [
          { exercise: "trap-bar-deadlift", sets: 3, reps: [5, 5], rir: 2, rest: 180, scheme: "straight" },
          { exercise: "paused-bench", sets: 4, reps: [5, 6], rir: 2, rest: 150, scheme: "straight" },
        ] },
        { title: "Build", superset: true, items: [
          { exercise: "pull-up", sets: 4, reps: [6, 10], rir: 1, rest: 90, scheme: "straight" },
          { exercise: "landmine-press", sets: 3, reps: [8, 10], rir: 1, rest: 60, scheme: "straight" },
        ] },
        { title: "Core and finisher", items: [
          { exercise: "back-extension", sets: 2, reps: [12, 15], rir: 3, rest: 60, scheme: "straight" },
          { exercise: "farmer-carry", sets: 4, reps: [30, 30], rir: 1, rest: 60, scheme: "timed", note: "4 × 30 m, heavy" },
        ] },
      ],
    },
    {
      key: "C",
      name: "Close-grip bench and single leg",
      focus: "Lockout strength, legs one at a time, arms and shoulders.",
      warmup: [...WARMUP, "Bench warm-up sets: bar × 10, then 2 to 3 building sets"],
      blocks: [
        { title: "Power", items: [
          { exercise: "lateral-bound", sets: 3, reps: [3, 3], rir: 3, rest: 45, scheme: "power" },
          { exercise: "plyo-pushup", sets: 3, reps: [5, 5], rir: 3, rest: 60, scheme: "power" },
        ] },
        { title: "Strength", items: [
          { exercise: "close-grip-bench", sets: 4, reps: [6, 8], rir: 2, rest: 150, scheme: "straight" },
          { exercise: "split-squat", sets: 3, reps: [8, 10], rir: 2, rest: 90, scheme: "straight" },
        ] },
        { title: "Build", superset: true, items: [
          { exercise: "one-arm-row", sets: 3, reps: [10, 12], rir: 1, rest: 60, scheme: "straight" },
          { exercise: "incline-db", sets: 3, reps: [8, 12], rir: 1, rest: 75, scheme: "straight" },
          { exercise: "ham-curl", sets: 3, reps: [8, 12], rir: 1, rest: 60, scheme: "straight" },
        ] },
        { title: "Arms and finisher", superset: true, items: [
          { exercise: "curl", sets: 3, reps: [10, 12], rir: 1, rest: 45, scheme: "straight" },
          { exercise: "pushdown", sets: 3, reps: [10, 15], rir: 1, rest: 45, scheme: "straight" },
          { exercise: "rower-intervals", sets: 4, reps: [250, 250], rir: 0, rest: 90, scheme: "timed", note: "4 × 250 m, 90 s easy" },
        ] },
      ],
    },
  ],
};

export function workout(key: string): Workout | undefined {
  return PROGRAM.workouts.find((w) => w.key === key);
}

/** The exercise to do, swapping for an alternative when the gym lacks its kit. */
export function resolve(key: string, missing: string[]): Exercise | undefined {
  const seen = new Set<string>();
  let e = EXERCISE_MAP.get(key);
  while (e && e.equipment.some((q) => missing.includes(q))) {
    seen.add(e.key);
    const next = e.alts.map((a) => EXERCISE_MAP.get(a)).find((a) => a && !seen.has(a.key));
    if (!next) return e;
    e = next;
  }
  return e;
}

export const BENCH_LIFTS = ["bench", "paused-bench", "close-grip-bench"];
