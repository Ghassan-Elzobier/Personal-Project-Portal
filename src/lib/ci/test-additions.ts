// Telling new tests added to an existing test file from a change to the tests
// already there (scripts/guard.mjs). The rules say to add tests freely and need
// the owner's label only to change or delete one, so a diff that only appends
// tests passes, and anything the reader can't be sure of falls back to the label.

/** The acceptance checks: changing or deleting one needs the owner's label. */
const PROTECTED = [/\.test\.ts$/, /^e2e\/.+\.spec\.ts$/, /^e2e\/__screenshots__\//, /^supabase\/tests\//];

/**
 * The files where new tests may be appended without the label. Screenshots and
 * pgTAP stay fully protected: a pgTAP file's `plan(n)` line would change anyway.
 */
const APPENDABLE = [/\.test\.ts$/, /^e2e\/.+\.spec\.ts$/];

export const isProtected = (path: string) => PROTECTED.some((re) => re.test(path));
export const isAppendable = (path: string) => APPENDABLE.some((re) => re.test(path));

export interface Change {
  status: string;
  from: string;
  to: string;
}

/**
 * Splits the changes to existing acceptance checks into those that need the
 * owner's label and the test files that only had tests appended to them.
 */
export function protectedChanges(
  changes: Change[],
  onlyAppends: (path: string) => boolean,
): { touched: Change[]; addedTo: Change[] } {
  const touched: Change[] = [];
  const addedTo: Change[] = [];
  for (const c of changes) {
    if (!["M", "D", "R"].includes(c.status) || !isProtected(c.from)) continue;
    if (c.status === "M" && isAppendable(c.from) && onlyAppends(c.from)) addedTo.push(c);
    else touched.push(c);
  }
  return { touched, addedTo };
}

// Added code that changes how the tests already in the file run, or switches one
// off: hooks, configuration, module-wide mocks, focus and skips.
const CHANGES_OTHERS = [
  /\b(?:before|beforeEach|beforeAll|after|afterEach|afterAll)\s*\(/,
  /\btest\.use\s*\(/,
  /\.configure\s*\(/,
  /(?<![.\w])mock\./,
  /\.(?:only|skip|fixme|todo)\b/,
  /\b(?:only|skip|todo)\s*:/,
  /\bx(?:test|it|describe)\s*\(/,
];

// What a line at the top level of appended code may start with: a test or group,
// a declaration, a comment, or the close of one of those. A bare statement there
// (`shared.count = 2;`) could change what the earlier tests see.
const TOP_LEVEL = [
  /^$/,
  /^(?:test|it|describe)(?:\.describe)?\s*\(/,
  /^(?:export\s+)?(?:async\s+)?function\b/,
  /^(?:export\s+)?(?:const|let|type|interface)\s/,
  /^\/\/|^\/\*|^\*/,
  /^[}\])]/,
];

const IMPORT = /^import\s.+\sfrom\s+["'][^"']+["'];?$/;

/**
 * Whether one file's `git diff -U0` only appends tests: no line is removed or
 * changed, every insertion is at the end of the file (after line `baseLines`, the
 * file's length on the base branch) or is complete one-line imports, and nothing
 * added changes how the existing tests run.
 */
export function onlyAppendsTests(diff: string, baseLines: number): boolean {
  let hunks = 0;
  let atEnd = false;
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (hunk) {
      if ((hunk[2] ?? "1") !== "0") return false;
      atEnd = Number(hunk[1]) === baseLines;
      hunks++;
    } else if (line.startsWith("-") && !line.startsWith("--- ")) {
      return false;
    } else if (line.startsWith("+") && !line.startsWith("+++ ")) {
      const added = line.slice(1);
      if (CHANGES_OTHERS.some((re) => re.test(added))) return false;
      if (IMPORT.test(added)) continue;
      // Indented lines sit inside a test, group or declaration that opened at the top level.
      if (!atEnd || !(/^\s/.test(added) || TOP_LEVEL.some((re) => re.test(added)))) return false;
    } else if (line.startsWith("\\") || line.startsWith("Binary")) {
      return false;
    }
  }
  return hunks > 0;
}
