// A three-day full-body programme for strength, muscle and athletic fitness, with
// the bench as the priority lift.
//
// Why this shape:
// - Full body three times a week trains each muscle two or three times. Muscle
//   keeps growing with more weekly sets, with diminishing returns, and more
//   sessions a week mainly help strength (Pelland et al. 2024). The core week gives
//   each big muscle group about 9 to 14 hard sets, a helper muscle counting half.
// - The bench is a skill as well as strength, so it comes twice a week, heavy in A
//   and paused in C, with an incline press in B. Each main lift has a rep range and
//   a target of reps in reserve, which keeps sets hard but not to failure (Helms et
//   al. 2016 on RIR-based loading).
// - Power with no jumps or throws, which this gym has no room for: every ramp-up
//   rep and main lift is moved as fast as possible, since the intent to move fast is
//   what trains speed (Behm and Sale 1993), plus bike sprints and a fast woodchop.
// - Lower back friendly for a back that dislikes bending under load: no bent-over
//   rows, no Romanian deadlifts and no back extensions. Rows are supported, the
//   hinge is the trap bar deadlift (load in line with the body) learned light,
//   and every warm-up has McGill's "big three" for trunk endurance.
// - Every block pairs two moves that don't compete, and a prescription's `rest` is
//   the wait before the next set in the session's order, so the partner is done
//   inside the main lift's rest. Pairing cuts training time by about a third with
//   similar reps and load (Zhang, Weakley et al. 2025). Resting over 60 s helps
//   growth a little, with no clear gain past 90 s (Singer et al. 2024): each
//   exercise here comes round every 2 to 3.5 minutes.
// - Optional blocks come last and are the first thing dropped when time is short.
//   duration.ts works out how long each block and session takes.
// - The warm-up rolls the day's muscles on a vibrating roller, which adds range of
//   motion without costing strength (Wiewelhove et al. 2019). The massage gun waits
//   for the recovery: it is advised against in the 5 minutes before strength work
//   (Ferreira et al. 2023).
//
// Every exercise lists alternatives, so missing kit never stops a session. Pure data.

export type Equipment =
  | "barbell"
  | "rack"
  | "bench"
  | "dumbbells"
  | "cable"
  | "box"
  | "med-ball"
  | "trap-bar"
  | "pull-up-bar"
  | "bike"
  | "rower"
  | "sled"
  | "landmine"
  | "leg-press"
  | "leg-extension"
  | "ham-curl"
  | "back-extension"
  | "kettlebell"
  | "dip-station"
  | "ab-wheel";

export type Load = "barbell" | "dumbbell" | "machine" | "bodyweight" | "ball" | "time" | "distance";

export type Muscle =
  "chest" | "back" | "shoulders" | "biceps" | "triceps" | "quads" | "hamstrings" | "glutes" | "calves" | "core";

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
  /** What a set counts for: 1 for a muscle that does the work, 0.5 for one that helps. */
  muscles?: Partial<Record<Muscle, number>>;
};

export const EXERCISES: Exercise[] = [
  // Power
  {
    key: "box-jump",
    name: "Box jump",
    equipment: ["box"],
    load: "bodyweight",
    step: 0,
    cues: [
      "Swing the arms and jump as high as you can, not just onto the box",
      "Land softly in a quarter squat",
      "Step down, never jump down",
    ],
    alts: ["squat-jump"],
  },
  {
    key: "squat-jump",
    name: "Squat jump",
    equipment: [],
    load: "bodyweight",
    step: 0,
    cues: ["Dip to a quarter squat and explode up", "Reset fully between reps"],
    alts: [],
  },
  {
    key: "broad-jump",
    name: "Broad jump",
    equipment: [],
    load: "bodyweight",
    step: 0,
    cues: ["Jump as far forward as you can", "Stick the landing for a second", "Walk back and reset"],
    alts: ["squat-jump"],
  },
  {
    key: "lateral-bound",
    name: "Lateral bound",
    equipment: [],
    load: "bodyweight",
    step: 0,
    perSide: true,
    cues: ["Push off one leg sideways", "Land on the other and hold for 2 seconds"],
    alts: [],
  },
  {
    key: "mb-chest-pass",
    name: "Medicine ball chest pass",
    equipment: ["med-ball"],
    load: "ball",
    step: 0,
    cues: [
      "Stand an arm's length from a wall",
      "Throw as hard as you can from the chest, like a fast bench",
      "Catch, reset, repeat",
    ],
    alts: ["plyo-pushup"],
  },
  {
    key: "plyo-pushup",
    name: "Plyometric push-up",
    equipment: [],
    load: "bodyweight",
    step: 0,
    cues: ["Lower under control, push so hard your hands leave the floor"],
    alts: [],
  },
  {
    key: "mb-slam",
    name: "Medicine ball slam",
    equipment: ["med-ball"],
    load: "ball",
    step: 0,
    cues: [
      "Ball overhead on your toes, ribs down",
      "Slam it into the floor as hard as you can, hinging at the hips",
      "Catch the bounce or pick it up with a flat back",
    ],
    back: "Use a light ball (4 to 6 kg) and pick it up by squatting, not bending.",
    alts: ["box-jump"],
  },
  {
    key: "mb-scoop-toss",
    name: "Medicine ball rotational throw",
    equipment: ["med-ball"],
    load: "ball",
    step: 0,
    perSide: true,
    cues: [
      "Side-on to a wall",
      "Load the back hip and turn it through hard",
      "The power comes from the hips, not the arms",
    ],
    back: "Turn from the hips, keeping the ribs stacked over the pelvis.",
    alts: ["cable-woodchop"],
  },

  // Bench
  {
    key: "bench",
    name: "Bench press",
    equipment: ["barbell", "bench", "rack"],
    load: "barbell",
    step: 2.5,
    cues: [
      "Shoulder blades squeezed back and down, feet planted",
      "Bar to the lower chest, elbows about 45° from the body",
      "Lower under control, then drive up as fast as you can, slightly back towards the rack",
    ],
    alts: ["db-bench"],
    start: "Build up in sets of 5 from the empty bar until it feels like 3 left in the tank.",
    muscles: { chest: 1, triceps: 0.5, shoulders: 0.5 },
  },
  {
    key: "paused-bench",
    name: "Paused bench press",
    equipment: ["barbell", "bench", "rack"],
    load: "barbell",
    step: 2.5,
    cues: [
      "Lower to the chest and hold still for a full second",
      "Stay tight through the pause, then press up as fast as you can",
    ],
    alts: ["db-bench"],
    start: "About 85% of your bench set-of-5 weight.",
    muscles: { chest: 1, triceps: 0.5, shoulders: 0.5 },
  },
  {
    key: "close-grip-bench",
    name: "Close-grip bench press",
    equipment: ["barbell", "bench", "rack"],
    load: "barbell",
    step: 2.5,
    cues: ["Hands just inside shoulder width", "Elbows tucked; feel it in the triceps"],
    alts: ["db-bench"],
    start: "About 85% of your bench set-of-5 weight.",
  },
  {
    key: "db-bench",
    name: "Dumbbell bench press",
    equipment: ["dumbbells", "bench"],
    load: "dumbbell",
    step: 2,
    cues: ["Full range: stretch at the bottom", "Press up and slightly in"],
    alts: [],
  },
  {
    key: "incline-db",
    name: "Incline dumbbell press",
    equipment: ["dumbbells", "bench"],
    load: "dumbbell",
    step: 2,
    cues: ["Bench at 30°", "Upper chest and shoulders: the 'athletic' look"],
    alts: ["db-bench"],
    muscles: { chest: 1, shoulders: 0.5, triceps: 0.5 },
  },

  // Lower body
  {
    key: "back-squat",
    name: "Barbell back squat",
    equipment: ["barbell", "rack"],
    load: "barbell",
    step: 2.5,
    cues: [
      "Bar on the upper back, hands just outside the shoulders",
      "Big breath into the belly and brace before each rep",
      "Sit down between the heels to at least parallel, then drive up through the whole foot as fast as you can",
    ],
    back: "Keep the chest proud and the brace tight; stop a set as soon as the hips shoot up first.",
    alts: ["front-squat", "goblet-squat", "leg-press"],
    start: "Build up in sets of 5 from the empty bar until it feels like 3 left in the tank.",
    muscles: { quads: 1, glutes: 0.5 },
  },
  {
    key: "front-squat",
    name: "Barbell front squat",
    equipment: ["barbell", "rack"],
    load: "barbell",
    step: 2.5,
    cues: ["Elbows high, bar on the shoulders", "Sit straight down between the heels", "Brace before each rep"],
    back: "Upright torso, so far less load on the lower back than a back squat.",
    alts: ["goblet-squat", "leg-press"],
    start: "Start with the empty bar to learn the rack position.",
  },
  {
    key: "goblet-squat",
    name: "Goblet squat",
    equipment: ["dumbbells"],
    load: "dumbbell",
    step: 2,
    cues: ["Dumbbell held at the chest", "Elbows inside the knees at the bottom"],
    back: "Front-loaded and upright, the friendliest squat for a sensitive back.",
    alts: [],
  },
  {
    key: "leg-press",
    name: "Leg press",
    equipment: ["leg-press"],
    load: "machine",
    step: 5,
    cues: ["Lower until the hips are about to tuck, no further", "Lower back stays on the pad"],
    back: "Keep the lower back on the pad: the range stops before the hips curl up.",
    alts: ["goblet-squat"],
  },
  {
    key: "trap-bar-deadlift",
    name: "Trap bar deadlift",
    equipment: ["trap-bar"],
    load: "barbell",
    step: 5,
    cues: [
      "Stand in the middle, shins near the bars, hips back and chest up",
      "Brace, take the slack out of the bar, then push the floor away as fast as you can",
      "Stand tall at the top, no leaning back; lower with the same flat back",
    ],
    back: "The load sits in line with you, so the back works far less than in a straight-bar deadlift. New lift: add weight only when every rep looks the same, and stop at the first sign of the back rounding.",
    alts: ["hip-thrust", "glute-bridge"],
    start: "Learn it light: 3 sets of 5 at about 50 to 60 kg (the bar is usually 20 to 25 kg).",
    muscles: { glutes: 1, quads: 0.5, hamstrings: 0.5 },
  },
  {
    key: "db-rdl",
    name: "Dumbbell Romanian deadlift",
    equipment: ["dumbbells"],
    load: "dumbbell",
    step: 2,
    cues: [
      "Soft knees, push the hips back",
      "Dumbbells slide down the thighs",
      "Stop when the hamstrings are tight and the back is still flat",
    ],
    back: "Only go as low as you can keep a flat back.",
    alts: ["hip-thrust"],
  },
  {
    key: "hip-thrust",
    name: "Barbell hip thrust",
    equipment: ["barbell", "bench"],
    load: "barbell",
    step: 5,
    cues: [
      "Upper back on the bench, bar over the hips with a pad",
      "Chin tucked, drive through the heels",
      "Squeeze at the top, ribs down",
    ],
    back: "Strong hips without loading the spine. Don't arch at the top.",
    alts: ["glute-bridge"],
    muscles: { glutes: 1, hamstrings: 0.5 },
  },
  {
    key: "glute-bridge",
    name: "Dumbbell glute bridge",
    equipment: ["dumbbells"],
    load: "dumbbell",
    step: 2,
    cues: ["Back on the floor, drive the hips up and squeeze"],
    alts: [],
  },
  {
    key: "split-squat",
    name: "Bulgarian split squat",
    equipment: ["dumbbells", "bench"],
    load: "dumbbell",
    step: 2,
    perSide: true,
    cues: ["Back foot on the bench", "Front shin fairly vertical, drop the back knee", "Push through the front foot"],
    back: "Single leg means heavy legs with light spinal load.",
    alts: ["reverse-lunge"],
    muscles: { quads: 1, glutes: 1 },
  },
  {
    key: "reverse-lunge",
    name: "Dumbbell reverse lunge",
    equipment: ["dumbbells"],
    load: "dumbbell",
    step: 2,
    perSide: true,
    cues: ["Step back, drop the knee, drive back up"],
    alts: [],
  },
  {
    key: "leg-extension",
    name: "Leg extension",
    equipment: ["leg-extension"],
    load: "machine",
    step: 2.5,
    cues: [
      "Pad on the lower shin, knee in line with the machine's pivot",
      "Squeeze at the top for a second, lower slowly",
    ],
    alts: ["goblet-squat"],
    muscles: { quads: 1 },
  },
  {
    key: "ham-curl",
    name: "Lying hamstring curl",
    equipment: ["ham-curl"],
    load: "machine",
    step: 2.5,
    cues: ["Hips pressed into the pad", "Lower slowly, 3 seconds"],
    alts: ["nordic"],
    muscles: { hamstrings: 1 },
  },
  {
    key: "nordic",
    name: "Assisted Nordic curl",
    equipment: [],
    load: "bodyweight",
    step: 0,
    cues: ["Knees on a pad, heels anchored", "Lower as slowly as you can, push back up with the hands"],
    alts: [],
  },

  {
    key: "calf-raise",
    name: "Single-leg calf raise",
    equipment: ["dumbbells"],
    load: "dumbbell",
    step: 2,
    perSide: true,
    cues: [
      "Ball of the foot on a step, a dumbbell in the hand on the same side",
      "All the way down into the stretch and pause, then all the way up",
    ],
    alts: [],
    start: "Bodyweight first: leave the weight empty until 15 a side feels easy.",
    muscles: { calves: 1 },
  },

  // Upper back and arms
  {
    key: "cable-fly",
    name: "Cable fly",
    equipment: ["cable"],
    load: "machine",
    step: 2.5,
    cues: [
      "Pulleys at shoulder height, a step forward",
      "Soft elbows, hug a big tree",
      "Squeeze for a second where the hands meet",
    ],
    alts: ["db-fly"],
    muscles: { chest: 1, shoulders: 0.5 },
  },
  {
    key: "db-fly",
    name: "Dumbbell fly",
    equipment: ["dumbbells", "bench"],
    load: "dumbbell",
    step: 2,
    cues: ["Soft elbows, lower to a deep stretch", "Bring them up in an arc, not a press"],
    alts: [],
  },
  {
    key: "dips",
    name: "Parallel bar dip",
    equipment: ["dip-station"],
    load: "bodyweight",
    step: 2.5,
    cues: [
      "Lean slightly forward for chest, upright for triceps",
      "Lower until the shoulders are level with the elbows",
      "Add weight with a belt once you get 12 clean reps",
    ],
    alts: ["close-grip-pushup"],
  },
  {
    key: "close-grip-pushup",
    name: "Close-grip push-up",
    equipment: [],
    load: "bodyweight",
    step: 0,
    cues: ["Hands under the shoulders, elbows brushing the ribs"],
    alts: [],
  },
  {
    key: "chest-row",
    name: "Chest-supported dumbbell row",
    equipment: ["dumbbells", "bench"],
    load: "dumbbell",
    step: 2,
    cues: ["Chest on a 30° bench", "Pull the elbows to the hips", "Pause at the top"],
    back: "The bench takes the load off the lower back.",
    alts: ["cable-row"],
    muscles: { back: 1, biceps: 0.5, shoulders: 0.5 },
  },
  {
    key: "cable-row",
    name: "Seated cable row",
    equipment: ["cable"],
    load: "machine",
    step: 2.5,
    cues: ["Sit tall, pull to the stomach", "Shoulders down, squeeze the shoulder blades"],
    alts: ["chest-row"],
    muscles: { back: 1, biceps: 0.5, shoulders: 0.5 },
  },
  {
    key: "one-arm-row",
    name: "One-arm dumbbell row",
    equipment: ["dumbbells", "bench"],
    load: "dumbbell",
    step: 2,
    perSide: true,
    cues: ["Hand and knee on the bench, back flat", "Pull to the hip"],
    alts: ["cable-row"],
  },
  {
    key: "pull-up",
    name: "Pull-up",
    equipment: ["pull-up-bar"],
    load: "bodyweight",
    step: 2.5,
    cues: ["Full hang to chin over the bar", "Add weight with a belt once you get 10 reps"],
    alts: ["lat-pulldown"],
    muscles: { back: 1, biceps: 0.5 },
  },
  {
    key: "lat-pulldown",
    name: "Lat pulldown",
    equipment: ["cable"],
    load: "machine",
    step: 2.5,
    cues: ["Pull the bar to the top of the chest", "Lead with the elbows"],
    alts: [],
  },
  {
    key: "landmine-press",
    name: "Half-kneeling landmine press",
    equipment: ["landmine", "barbell"],
    load: "barbell",
    step: 2.5,
    perSide: true,
    cues: ["One knee down, squeeze that glute", "Press up and forward, reach at the top"],
    back: "Kneeling with the glute squeezed stops you arching, unlike a standing overhead press.",
    alts: ["seated-db-press"],
    start: "Start with the empty bar plus 5 kg.",
  },
  {
    key: "seated-db-press",
    name: "Seated dumbbell shoulder press",
    equipment: ["dumbbells", "bench"],
    load: "dumbbell",
    step: 2,
    cues: ["Back supported, slight incline", "Press up, don't arch"],
    back: "Back supported on the bench.",
    alts: [],
  },
  {
    key: "lateral-raise",
    name: "Dumbbell lateral raise",
    equipment: ["dumbbells"],
    load: "dumbbell",
    step: 1,
    cues: ["Lead with the elbows, raise to shoulder height", "Slow on the way down"],
    alts: [],
    muscles: { shoulders: 1 },
  },
  {
    key: "face-pull",
    name: "Cable face pull",
    equipment: ["cable"],
    load: "machine",
    step: 2.5,
    cues: ["Rope at face height, pull to the eyes", "Thumbs back at the end"],
    alts: ["lateral-raise"],
    muscles: { shoulders: 1, back: 0.5 },
  },
  {
    key: "curl",
    name: "Dumbbell biceps curl",
    equipment: ["dumbbells"],
    load: "dumbbell",
    step: 1,
    cues: ["Elbows still, full range"],
    alts: [],
    muscles: { biceps: 1 },
  },
  {
    key: "pushdown",
    name: "Triceps rope pushdown",
    equipment: ["cable"],
    load: "machine",
    step: 2.5,
    cues: ["Elbows pinned to the sides", "Spread the rope at the bottom"],
    alts: ["db-skull"],
    muscles: { triceps: 1 },
  },
  {
    key: "lying-triceps-ext",
    name: "Lying triceps extension",
    equipment: ["barbell", "bench"],
    load: "barbell",
    step: 2.5,
    cues: [
      "EZ bar or straight bar, arms vertical over the shoulders",
      "Bend only at the elbows, lowering to the forehead or just behind",
      "Elbows stay pointing up",
    ],
    alts: ["db-skull"],
  },
  {
    key: "db-skull",
    name: "Dumbbell overhead triceps extension",
    equipment: ["dumbbells"],
    load: "dumbbell",
    step: 2,
    cues: ["Seated, elbows pointing up", "Lower behind the head, press up"],
    alts: [],
  },

  // Core and carries
  {
    key: "dead-bug",
    name: "Dead bug",
    equipment: [],
    load: "bodyweight",
    step: 0,
    perSide: true,
    cues: [
      "On your back, arms up, knees over hips",
      "Press the lower back into the floor and keep it there",
      "Lower the opposite arm and leg slowly, breathe out, return",
    ],
    back: "Trains the brace that protects the back, with no load on it.",
    alts: [],
  },
  {
    key: "hanging-leg-raise",
    name: "Hanging leg raise",
    equipment: ["pull-up-bar"],
    load: "bodyweight",
    step: 0,
    cues: [
      "Hang still, shoulders engaged",
      "Curl the pelvis up and lift the knees (or straight legs) to hip height or higher",
      "Lower slowly, no swinging",
    ],
    back: "Hanging also lets the spine decompress.",
    alts: ["captains-chair-raise"],
    muscles: { core: 1 },
  },
  {
    key: "captains-chair-raise",
    name: "Captain's chair knee raise",
    equipment: ["dip-station"],
    load: "bodyweight",
    step: 0,
    cues: ["Back against the pad, curl the knees to the chest", "Lower slowly"],
    alts: ["dead-bug"],
  },
  {
    key: "ab-wheel",
    name: "Ab wheel rollout",
    equipment: ["ab-wheel"],
    load: "bodyweight",
    step: 0,
    cues: [
      "From the knees, ribs down and glutes squeezed",
      "Roll out only as far as you can without the lower back sagging",
      "Pull back with the abs, not the hips",
    ],
    back: "Stop each rep before the lower back arches.",
    alts: ["dead-bug"],
  },
  {
    key: "cable-crunch",
    name: "Cable crunch",
    equipment: ["cable"],
    load: "machine",
    step: 2.5,
    cues: [
      "Kneel, rope by the ears",
      "Crunch the ribs towards the hips, hips stay still",
      "Squeeze, then return slowly",
    ],
    alts: ["ab-wheel"],
  },
  {
    key: "pallof",
    name: "Pallof press",
    equipment: ["cable"],
    load: "machine",
    step: 2.5,
    perSide: true,
    cues: ["Side-on to the cable", "Press the handle straight out and resist the twist"],
    back: "Anti-rotation: trains the trunk to stay still, which is what protects a back.",
    alts: ["side-plank"],
    muscles: { core: 1 },
  },
  {
    key: "side-plank",
    name: "Side plank",
    equipment: [],
    load: "time",
    step: 0,
    perSide: true,
    cues: ["Straight line from head to feet"],
    alts: [],
  },
  {
    key: "farmer-carry",
    name: "Farmer's carry",
    equipment: ["dumbbells"],
    load: "dumbbell",
    step: 2,
    cues: ["Heaviest dumbbells you can hold for 30 m", "Walk tall, short quick steps"],
    back: "Loads the trunk standing tall: one of the best back-friendly core drills.",
    alts: ["suitcase-carry"],
  },
  {
    key: "farmer-march",
    name: "Farmer march on the spot",
    equipment: ["dumbbells"],
    load: "dumbbell",
    step: 2,
    cues: [
      "The heaviest dumbbells you can hold for 30 s, one in each hand",
      "March on the spot, knees to hip height, standing tall without leaning",
    ],
    back: "Loads the trunk standing tall, like the carry, in the space of a mat.",
    alts: ["farmer-carry"],
    muscles: { core: 0.5 },
  },
  {
    key: "suitcase-carry",
    name: "Suitcase carry",
    equipment: ["dumbbells"],
    load: "dumbbell",
    step: 2,
    perSide: true,
    cues: ["One heavy dumbbell, don't lean"],
    alts: [],
  },
  {
    key: "back-extension",
    name: "45° back extension",
    equipment: ["back-extension"],
    load: "bodyweight",
    step: 0,
    cues: ["Hinge at the hips, not the lower back", "Squeeze the glutes to come up; stop level with the body"],
    back: "Light, high-rep endurance. Skip it on any day the back complains.",
    alts: ["bird-dog"],
  },
  {
    key: "bird-dog",
    name: "Bird dog",
    equipment: [],
    load: "time",
    step: 0,
    perSide: true,
    cues: ["Opposite arm and leg out, hold 8 seconds"],
    alts: [],
  },
  {
    key: "cable-woodchop",
    name: "Cable woodchop",
    equipment: ["cable"],
    load: "machine",
    step: 2.5,
    perSide: true,
    cues: ["Turn from the hips, arms just guide the handle"],
    alts: [],
    muscles: { core: 1 },
  },

  // Conditioning
  {
    key: "bike-sprint",
    name: "Bike sprints",
    equipment: ["bike"],
    load: "time",
    step: 0,
    cues: ["10 seconds flat out, 50 seconds easy", "Resistance high enough that you can't spin out"],
    alts: ["rower-intervals"],
    muscles: {},
  },
  {
    key: "rower-intervals",
    name: "Rower intervals",
    equipment: ["rower"],
    load: "distance",
    step: 0,
    cues: ["Legs, then body, then arms", "250 m hard, 90 seconds easy"],
    alts: ["bike-sprint"],
  },
  {
    key: "sled-push",
    name: "Sled push",
    equipment: ["sled"],
    load: "machine",
    step: 10,
    cues: ["Low body angle, drive with short steps"],
    alts: ["farmer-carry"],
  },
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
  /**
   * Seconds from the end of this set to the next set in the session's order
   * (next-set.ts). In a pair that next set is the partner's, so the partner is
   * done inside the main lift's rest, and the main lift comes round again after
   * this rest, the partner's set and the partner's rest.
   */
  rest: number;
  scheme: Scheme;
  /** Shown on the card, e.g. "6 × 10 s". */
  note?: string;
  /** Lighter sets before the first working set, shown on the card and timed with the block. */
  ramp?: string[];
};

export type Block = {
  title: string;
  items: Prescription[];
  superset?: boolean;
  /** An extra: done last, and the first thing dropped when time is short. */
  optional?: boolean;
};

/** One timed step of a warm-up or a recovery. */
export type Step = { text: string; seconds: number; optional?: boolean };

export type Workout = {
  key: "A" | "B" | "C";
  name: string;
  focus: string;
  warmup: Step[];
  recovery: Step[];
  blocks: Block[];
};

/** Nine minutes, the same shape every session; the roller works the day's two areas. */
const warmup = (first: string, second: string, mobility: string): Step[] => [
  { text: "Bike: 2 min easy, then 3 spin-ups of 6 s as fast as you can, with 14 s easy between", seconds: 180 },
  { text: `Vibrating roller: 75 s on ${first}, then 75 s on ${second}`, seconds: 150 },
  {
    text: "McGill big three: 3 curl-ups, 3 bird dogs a side and a 10 s side plank a side, holding each 8 to 10 s",
    seconds: 120,
  },
  { text: `World's greatest stretch, 3 a side, then ${mobility}`, seconds: 60 },
  { text: "Walk to the first station: its ramp-up sets come next", seconds: 30 },
];

/**
 * Four minutes of massage gun on a low setting, more than 2 minutes a muscle group
 * as the evidence on soreness suggests, and an optional stretch for range of motion.
 */
const recovery = (first: string, second: string): Step[] => [
  { text: `Massage gun on a low setting: 2 min on ${first}, then 2 min on ${second}, breathing slowly`, seconds: 240 },
  {
    text: "Mobility: couch stretch 30 s a side, glute squeezed and ribs down, then a lat stretch holding the rack 30 s a side",
    seconds: 120,
    optional: true,
  },
];

const SPRINTS: Prescription = {
  exercise: "bike-sprint",
  sets: 6,
  reps: [10, 10],
  rir: 0,
  rest: 50,
  scheme: "timed",
  note: "6 × 10 s flat out, 50 s easy between",
};

const CALVES: Prescription = { exercise: "calf-raise", sets: 3, reps: [10, 15], rir: 1, rest: 45, scheme: "straight" };

export const PROGRAM: { key: string; name: string; summary: string; workouts: Workout[] } = {
  key: "athletic-3",
  name: "Athletic full body, 3 days",
  summary:
    "Three full-body sessions in turn. Each block pairs a main lift with a move done inside its rest, the bench comes twice a week, and optional extras come last, to drop first when time is short.",
  workouts: [
    {
      key: "A",
      name: "Heavy bench and back squat",
      focus: "Top-end bench strength and the squat, with hamstrings, shoulders and abs in between.",
      warmup: warmup("the quads", "the upper back", "10 band pull-aparts"),
      recovery: recovery("the quads", "the chest"),
      blocks: [
        {
          title: "Bench and row",
          superset: true,
          items: [
            {
              exercise: "bench",
              sets: 4,
              reps: [4, 6],
              rir: 2,
              rest: 60,
              scheme: "top-backoff",
              note: "1 top set of 4 to 6, then 3 × 5 at 90%",
              ramp: ["the bar × 10", "50% × 5", "70% × 3", "85% × 1"],
            },
            { exercise: "chest-row", sets: 3, reps: [8, 10], rir: 1, rest: 75, scheme: "straight" },
          ],
        },
        {
          title: "Squat and leg raise",
          superset: true,
          items: [
            {
              exercise: "back-squat",
              sets: 3,
              reps: [5, 6],
              rir: 2,
              rest: 75,
              scheme: "straight",
              ramp: ["the bar × 8", "60% × 5", "80% × 3"],
            },
            { exercise: "hanging-leg-raise", sets: 3, reps: [8, 12], rir: 1, rest: 75, scheme: "straight" },
          ],
        },
        {
          title: "Hamstrings and shoulders",
          superset: true,
          items: [
            { exercise: "ham-curl", sets: 3, reps: [10, 12], rir: 1, rest: 45, scheme: "straight" },
            { exercise: "lateral-raise", sets: 3, reps: [12, 15], rir: 1, rest: 45, scheme: "straight" },
          ],
        },
        {
          title: "Extras: chest and calves",
          superset: true,
          optional: true,
          items: [{ exercise: "cable-fly", sets: 2, reps: [12, 15], rir: 1, rest: 45, scheme: "straight" }, CALVES],
        },
      ],
    },
    {
      key: "B",
      name: "Trap bar, pull-ups and incline",
      focus: "Learning the hinge, a strong back, the upper chest and the glutes.",
      warmup: warmup("the glutes", "the lats", "10 bodyweight hip hinges"),
      recovery: recovery("the glutes", "the lats"),
      blocks: [
        {
          title: "Hinge and anti-rotation",
          superset: true,
          items: [
            {
              exercise: "trap-bar-deadlift",
              sets: 3,
              reps: [5, 5],
              rir: 3,
              rest: 60,
              scheme: "straight",
              note: "3 × 5, light while you learn it",
              ramp: ["40% × 5", "60% × 3", "80% × 2"],
            },
            { exercise: "pallof", sets: 3, reps: [10, 10], rir: 2, rest: 45, scheme: "straight" },
          ],
        },
        {
          title: "Pull and incline",
          superset: true,
          items: [
            { exercise: "pull-up", sets: 4, reps: [6, 10], rir: 1, rest: 60, scheme: "straight" },
            {
              exercise: "incline-db",
              sets: 3,
              reps: [8, 12],
              rir: 1,
              rest: 60,
              scheme: "straight",
              ramp: ["about 50% × 8"],
            },
          ],
        },
        {
          title: "Glutes and upper back",
          superset: true,
          items: [
            { exercise: "hip-thrust", sets: 3, reps: [8, 12], rir: 2, rest: 60, scheme: "straight" },
            { exercise: "face-pull", sets: 3, reps: [12, 15], rir: 1, rest: 45, scheme: "straight" },
          ],
        },
        { title: "Extras: sprints", optional: true, items: [SPRINTS] },
        {
          title: "Extras: carry and calves",
          superset: true,
          optional: true,
          items: [
            {
              exercise: "farmer-march",
              sets: 3,
              reps: [30, 30],
              rir: 1,
              rest: 45,
              scheme: "timed",
              note: "3 × 30 s, heavy",
            },
            CALVES,
          ],
        },
      ],
    },
    {
      key: "C",
      name: "Paused bench, single leg and sprints",
      focus: "Bench strength off the chest, legs one at a time, rotation and some hard fitness work.",
      warmup: warmup("the quads and hip flexors", "the glutes", "10 band pull-aparts"),
      recovery: recovery("the quads", "the hamstrings"),
      blocks: [
        {
          title: "Paused bench and row",
          superset: true,
          items: [
            {
              exercise: "paused-bench",
              sets: 3,
              reps: [6, 8],
              rir: 2,
              rest: 60,
              scheme: "straight",
              ramp: ["the bar × 10", "60% × 5", "80% × 2"],
            },
            { exercise: "cable-row", sets: 3, reps: [8, 12], rir: 1, rest: 75, scheme: "straight" },
          ],
        },
        {
          title: "Single leg and rotation",
          superset: true,
          items: [
            {
              exercise: "split-squat",
              sets: 3,
              reps: [8, 10],
              rir: 2,
              rest: 60,
              scheme: "straight",
              ramp: ["bodyweight × 6 a side"],
            },
            {
              exercise: "cable-woodchop",
              sets: 3,
              reps: [6, 8],
              rir: 2,
              rest: 45,
              scheme: "straight",
              note: "3 × 6–8 a side: fast through, slow back",
            },
          ],
        },
        {
          title: "Quads and hamstrings",
          superset: true,
          items: [
            { exercise: "leg-extension", sets: 3, reps: [12, 15], rir: 1, rest: 45, scheme: "straight" },
            { exercise: "ham-curl", sets: 3, reps: [10, 12], rir: 1, rest: 45, scheme: "straight" },
          ],
        },
        { title: "Sprints", items: [SPRINTS] },
        {
          title: "Extras: arms",
          superset: true,
          optional: true,
          items: [
            { exercise: "curl", sets: 3, reps: [10, 12], rir: 1, rest: 45, scheme: "straight" },
            { exercise: "pushdown", sets: 3, reps: [10, 15], rir: 1, rest: 45, scheme: "straight" },
          ],
        },
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
