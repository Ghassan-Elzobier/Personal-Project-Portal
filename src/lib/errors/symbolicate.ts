// Turning minified stack frames back into source lines with the build's own
// source maps, the way Sentry does. The maps are never public: next.config.ts
// packs them into the server functions, src/proxy.ts refuses them to browsers,
// and the server reads them from disk (src/lib/errors/store.ts). So this works
// the same whether the repository is public or private.
//
// Pure: the caller passes in how to find a map, so it is tested with small
// hand-made maps.

/** The mapping at or before a generated position, zero-based (node:module's SourceMap.findEntry). */
type Entry = { generatedLine?: number; originalSource?: string; originalLine?: number; originalColumn?: number };
type Map = { findEntry(line: number, column: number): Entry | object };

/** Finds the map for a build file such as `.next/static/chunks/a.js`, or null when there is none. */
export type MapLookup = (file: string) => Map | null;

// "    at fn (location:line:col)", "    at location:line:col" and "fn@location:line:col".
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+):(\d+):(\d+)\)?$/;
const AT_FRAME = /^([^@\s]*)@(.+):(\d+):(\d+)$/;

/** The build file a frame's location points to, or null for anything that is not one. */
export function buildFile(location: string): string | null {
  const match = /(?:\/_next\/|(?:^|\/)\.next\/)(static|server)\/([^?#:\s)]+\.js)(?:[?#]|$)/.exec(location);
  if (!match || match[2].split("/").includes("..")) return null;
  return `.next/${match[1]}/${match[2]}`;
}

/** A source path from a map (`turbopack:///[project]/src/…`, `../../src/…`) as a path in the repository. */
export function sourcePath(fileName: string): string {
  const path = fileName.replace(/^[a-z]+:\/\/\/?/i, "");
  const modules = path.lastIndexOf("node_modules/");
  if (modules >= 0) return path.slice(modules);
  return path.replace(/^\[project\]\//, "").replace(/^(?:\.\.?\/)+/, "");
}

function mapLine(line: string, lookup: MapLookup): string {
  const v8 = V8_FRAME.exec(line);
  const at = v8 ? null : AT_FRAME.exec(line);
  const parts = v8 ?? at;
  if (!parts) return line;
  const [, name, location, row, column] = parts;
  const file = buildFile(location);
  if (!file) return line;
  let entry: Entry;
  try {
    const map = lookup(file);
    if (!map) return line;
    entry = map.findEntry(Number(row) - 1, Number(column) - 1) as Entry;
  } catch {
    return line;
  }
  // Only a mapping on the frame's own generated line counts: an earlier line's
  // would be a guess, and a wrong source line is worse than a minified one.
  if (!entry.originalSource || entry.generatedLine !== Number(row) - 1 || entry.originalLine === undefined) {
    return line;
  }
  const where = `${sourcePath(entry.originalSource)}:${entry.originalLine + 1}:${(entry.originalColumn ?? 0) + 1}`;
  // A minified name (one or two letters) says nothing, and would mislead next to a real file.
  const keep = name && name.length > 2 ? name : "";
  if (at) return `${keep}@${where}`;
  return keep ? `    at ${keep} (${where})` : `    at ${where}`;
}

/** The stack with every frame the build's maps know mapped back to its source line. */
export function symbolicateStack(stack: string, lookup: MapLookup): string {
  return stack
    .split("\n")
    .map((line) => mapLine(line, lookup))
    .join("\n");
}
