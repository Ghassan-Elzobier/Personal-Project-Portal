#!/usr/bin/env node
// Runs after `next build` (npm run build): keeps the build's source maps
// private and code-free, and gives them to the server, where the error tracker
// maps stack frames back to source lines (src/lib/errors/symbolicate.ts).
//
//   1. Moves the browser's maps out of .next/static, which is served to anyone,
//      into .next/server/source-maps/static, which is not, each named after the
//      chunk it maps (`<chunk>.js.map`). Turbopack gives a chunk's map a hash of
//      its own, so the chunk's `sourceMappingURL` says which map is whose.
//      (src/proxy.ts also refuses any .map request, in case one is left behind.)
//   2. Strips the source text (`sourcesContent`) from every map, browser and
//      server. Mapping a frame needs only positions and file names, so no map
//      carries a line of the project's code.
//   3. Adds to each server function's trace (.nft.json, the list of files a
//      function is deployed with) the maps of the server chunks it already uses,
//      and to the error intake's trace the browser's maps.
//   4. Warns if a trace includes the project's own files (outside .next and
//      node_modules): that means a function would deploy source it does not need.
//      e2e/error-maps-private.spec.ts fails on it.
//
// Turbopack writes the traces itself and ignores outputFileTracingIncludes,
// which is why this edits them. Prints what it did; changes nothing twice.
//
//   node scripts/pack-source-maps.mjs [distDir]   (default .next)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const dist = resolve(process.argv[2] ?? ".next");
const project = dirname(dist);
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

const posix = (path) => path.split(sep).join("/");

if (!existsSync(server)) {
  console.error(`pack-source-maps: no build at ${dist}; run next build first.`);
  process.exit(1);
}

/** The map a script names in its last line (`//# sourceMappingURL=…`), as a path, if it is a file beside it. */
function mapOf(script) {
  const text = readFileSync(script, "utf8");
  const ref = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(text.slice(-1000))?.[1];
  if (!ref || /^(?:data|https?):/.test(ref)) return null;
  try {
    return resolve(dirname(script), decodeURIComponent(ref));
  } catch {
    return null;
  }
}

const place = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
};

// 1. Browser maps out of the public folder, each under its chunk's name.
let moved = 0;
const placed = new Map();
for (const script of walk(staticDir)) {
  if (!script.endsWith(".js")) continue;
  const map = mapOf(script);
  const target = join(privateStatic, `${relative(staticDir, script)}.map`);
  if (map && existsSync(map)) {
    place(map, target);
    placed.set(map, target);
    moved += 1;
  } else if (map && placed.has(map)) {
    copyFileSync(placed.get(map), target);
  }
}
// Whatever is left (style sheets' maps, maps no chunk names) leaves the public folder too.
for (const file of walk(staticDir)) {
  if (!file.endsWith(".map")) continue;
  place(file, join(privateStatic, relative(staticDir, file)));
  moved += 1;
}

// 2. No source text in any map.
let stripped = 0;
let strippedBytes = 0;
for (const file of walk(server)) {
  if (!file.endsWith(".map")) continue;
  const text = readFileSync(file, "utf8");
  if (!text.includes('"sourcesContent"')) continue;
  const map = JSON.parse(text);
  delete map.sourcesContent;
  for (const section of map.sections ?? []) if (section.map) delete section.map.sourcesContent;
  const lean = JSON.stringify(map);
  strippedBytes += text.length - lean.length;
  writeFileSync(file, lean);
  stripped += 1;
}

// 3. Maps into the traces.
const browserMaps = [...walk(privateStatic)].filter((f) => f.endsWith(".js.map"));
let traces = 0;
let added = 0;
const projectFiles = new Map();
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
    // The server looks for `<chunk>.js.map`; a map named otherwise is copied to that name.
    const named = mapOf(script);
    if (!existsSync(`${script}.map`) && named && existsSync(named)) copyFileSync(named, `${script}.map`);
    if (existsSync(`${script}.map`)) files.add(posix(relative(base, `${script}.map`)));
  }
  if (traceFile === intakeTrace) {
    for (const map of browserMaps) files.add(posix(relative(base, map)));
  }
  if (files.size !== trace.files.length) {
    added += files.size - trace.files.length;
    traces += 1;
    writeFileSync(traceFile, JSON.stringify({ ...trace, files: [...files] }));
  }

  // 4. The project's own files have no business in a trace.
  const own = trace.files
    .map((f) => posix(relative(project, join(base, f))))
    .filter(
      (f) => !f.startsWith(".next/") && !f.startsWith("node_modules/") && !f.startsWith("../") && f !== "package.json",
    );
  if (own.length) projectFiles.set(posix(relative(project, traceFile)), own);
}

console.log(
  `pack-source-maps: moved ${moved} browser maps out of public files; stripped the source text from ${stripped} maps ` +
    `(${(strippedBytes / 1e6).toFixed(1)} MB); added ${added} map entries to ${traces} function traces.`,
);
if (!existsSync(intakeTrace)) console.warn("pack-source-maps: no trace for /api/errors; browser frames stay minified.");
for (const [trace, own] of projectFiles) {
  console.warn(
    `pack-source-maps: ${trace} deploys ${own.length} project files, such as ${own.slice(0, 3).join(", ")}.`,
  );
}
