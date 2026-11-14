#!/usr/bin/env node
// Runs after `next build` (npm run build): keeps the build's source maps
// private and gives them to the server, where the error tracker maps stack
// frames back to source lines (src/lib/errors/symbolicate.ts).
//
//   1. Moves the browser's maps out of .next/static, which is served to anyone,
//      into .next/server/source-maps/static, which is not. (src/proxy.ts also
//      refuses any .map request, in case one is ever left behind.)
//   2. Adds to each server function's trace (.nft.json, the list of files a
//      function is deployed with) the maps of the server chunks it already uses,
//      and to the error intake's trace the browser's maps.
//
// Turbopack writes the traces itself and ignores outputFileTracingIncludes,
// which is why this edits them. Prints what it did; changes nothing twice.
//
//   node scripts/pack-source-maps.mjs [distDir]   (default .next)
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const dist = resolve(process.argv[2] ?? ".next");
const server = join(dist, "server");
const staticDir = join(dist, "static");
const privateStatic = join(server, "source-maps", "static");
const intakeTrace = join(server, "app", "api", "errors", "route.js.nft.json");

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

if (!existsSync(server)) {
  console.error(`pack-source-maps: no build at ${dist}; run next build first.`);
  process.exit(1);
}

// 1. Browser maps (scripts' and styles') out of the public folder.
let moved = 0;
let movedBytes = 0;
for (const file of walk(staticDir)) {
  if (!file.endsWith(".map")) continue;
  const target = join(privateStatic, relative(staticDir, file));
  mkdirSync(dirname(target), { recursive: true });
  movedBytes += statSync(file).size;
  renameSync(file, target);
  moved += 1;
}
const browserMaps = [...walk(privateStatic)].filter((f) => f.endsWith(".js.map"));

// 2. Maps into the traces.
let traces = 0;
let added = 0;
for (const traceFile of walk(server)) {
  if (!traceFile.endsWith(".nft.json") || traceFile.startsWith(join(server, "source-maps") + sep)) continue;
  const trace = JSON.parse(readFileSync(traceFile, "utf8"));
  const base = dirname(traceFile);
  const files = new Set(trace.files);
  const entry = traceFile.slice(0, -".nft.json".length);
  const scripts = [entry, ...trace.files.map((f) => join(base, f))].filter(
    (f) => f.endsWith(".js") && f.startsWith(server + sep),
  );
  for (const script of scripts) {
    if (existsSync(`${script}.map`)) files.add(relative(base, `${script}.map`).split(sep).join("/"));
  }
  if (traceFile === intakeTrace) {
    for (const map of browserMaps) files.add(relative(base, map).split(sep).join("/"));
  }
  if (files.size !== trace.files.length) {
    added += files.size - trace.files.length;
    traces += 1;
    writeFileSync(traceFile, JSON.stringify({ ...trace, files: [...files] }));
  }
}

console.log(
  `pack-source-maps: moved ${moved} browser maps (${(movedBytes / 1e6).toFixed(1)} MB) out of public files; ` +
    `added ${added} map entries to ${traces} function traces.`,
);
if (!existsSync(intakeTrace)) console.warn("pack-source-maps: no trace for /api/errors; browser frames stay minified.");
