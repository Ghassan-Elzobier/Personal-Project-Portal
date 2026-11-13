// Keeps the Lab's line links honest. Every code reference in src/lib/lab/guide.ts
// is a line number at a pinned renderer commit; this records the code each one
// points at, and later finds where that code went.
//
//   npm run lab:anchors              record the anchors at the pinned commit
//   npm run lab:check                check them at the renderer's main branch
//   npm run lab:check -- --ref <sha> check them at any commit or branch
//
// Add --repo <path> to read a local checkout instead of GitHub. The check exits
// with 1 when anything moved or vanished, and says where each reference went, so
// moving RENDERER.commit forward is a list of line numbers to change.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_MAP, RENDERER, VIEWS } from "../src/lib/lab/guide.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../src/lib/lab/anchors.json");
const PATHS = { main: "src/main.cpp", shader: "shaders/raytrace.comp", cmake: "CMakeLists.txt" };
const REPO = RENDERER.repo.replace("https://github.com/", "");

const args = process.argv.slice(2);
const command = args[0];
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const repo = opt("--repo");

async function fileAt(ref, file) {
  if (repo)
    return execFileSync("git", ["-C", repo, "show", `${ref}:${PATHS[file]}`], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${ref}/${PATHS[file]}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Could not read ${PATHS[file]} at ${ref}: ${res.status}`);
  return res.text();
}

/** Every reference the Lab makes, once each. */
function references() {
  const refs = new Map();
  const add = (file, from, to) => refs.set(`${file}:${from}${to ? `-${to}` : ""}`, { file, from, to: to ?? from });
  for (const v of VIEWS) {
    for (const s of v.steps) for (const [f, a, b] of s.code ?? []) add(f, a, b);
    for (const x of v.findings ?? []) for (const [f, a, b] of x.code ?? []) add(f, a, b);
  }
  for (const c of CODE_MAP) add(c.file, c.from, c.to);
  return refs;
}

/** The first line in the range that says something: not blank, not just braces. */
function anchorOf(lines, from, to) {
  for (let n = from; n <= to; n++) {
    const text = (lines[n - 1] ?? "").trim();
    if (text.length >= 4 && !/^[{}()[\];,\s]*$/.test(text)) return { offset: n - from, text };
  }
  return { offset: 0, text: (lines[from - 1] ?? "").trim() };
}

async function record() {
  const files = {};
  for (const f of Object.keys(PATHS)) files[f] = (await fileAt(RENDERER.commit, f)).split("\n");
  const anchors = {};
  for (const [key, r] of references()) anchors[key] = anchorOf(files[r.file], r.from, r.to);
  writeFileSync(OUT, JSON.stringify({ commit: RENDERER.commit, anchors }, null, 1) + "\n");
  console.log(`Recorded ${Object.keys(anchors).length} anchors at ${RENDERER.short}.`);
}

async function check() {
  const ref = opt("--ref") ?? "main";
  const saved = JSON.parse(readFileSync(OUT, "utf8"));
  if (saved.commit !== RENDERER.commit) {
    console.error(
      `anchors.json is for ${saved.commit.slice(0, 7)}, but guide.ts pins ${RENDERER.short}. Run npm run lab:anchors first.`,
    );
    process.exit(1);
  }
  const files = {};
  for (const f of Object.keys(PATHS)) files[f] = (await fileAt(ref, f)).split("\n");
  const moved = [];
  const missing = [];
  for (const [key, a] of Object.entries(saved.anchors)) {
    const [file, range] = key.split(":");
    const from = Number(range.split("-")[0]);
    const want = from + a.offset;
    const hits = files[file].flatMap((l, i) => (l.trim() === a.text ? [i + 1] : []));
    if (!hits.length) missing.push({ key, a });
    else {
      const best = hits.reduce((p, h) => (Math.abs(h - want) < Math.abs(p - want) ? h : p));
      if (best !== want) moved.push({ key, by: best - want, to: best - a.offset });
    }
  }
  const total = Object.keys(saved.anchors).length;
  if (!moved.length && !missing.length) {
    console.log(`All ${total} references point at the same code at ${ref} as at ${RENDERER.short}.`);
    return;
  }
  console.log(`At ${ref}, compared with ${RENDERER.short}:`);
  for (const m of moved)
    console.log(`  moved   ${m.key.padEnd(18)} ${m.by > 0 ? "+" : ""}${m.by} lines, now starts at ${m.to}`);
  for (const m of missing)
    console.log(`  missing ${m.key.padEnd(18)} "${m.a.text.slice(0, 60)}" is no longer in the file`);
  console.log(
    `${moved.length} moved, ${missing.length} missing, ${total - moved.length - missing.length} unchanged. Update the line numbers in src/lib/lab/guide.ts, set RENDERER.commit, then run npm run lab:anchors.`,
  );
  process.exit(1);
}

if (command === "write") await record();
else if (command === "check") await check();
else {
  console.error("Use write or check.");
  process.exit(2);
}
