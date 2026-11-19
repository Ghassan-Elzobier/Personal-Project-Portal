import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The backups (scripts/backup.sh, docs/RESTORE.md) are run by three workflows.
// These checks hold the workflows to what the guide promises; whether a copy
// really restores is proved by the restore drill in CI, on a real database.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const backup = read(".github/workflows/backup.yml");
const release = read(".github/workflows/release.yml");
const ci = read(".github/workflows/ci.yml");
const script = read("scripts/backup.sh");

/** The names of a workflow's steps, in order, for steps that have one. */
const steps = (workflow: string) => [...workflow.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1]);

test("a copy is taken every night, with production's secrets, once the owner has set a key", () => {
  assert.match(backup, /^ {4}- cron: "17 2 \* \* \*"$/m);
  assert.match(backup, /^ {2}workflow_dispatch:$/m);
  assert.match(backup, /^ {4}if: vars\.SUPABASE_PROJECT_REF != '' && vars\.BACKUP_PUBLIC_KEY != ''$/m);
  assert.match(backup, /^ {4}environment: production$/m);
  assert.match(backup, /^ {8}run: bash scripts\/backup\.sh encrypted backup --remote$/m);
});

test("only encrypted files are ever uploaded: the repository is public, so its artifacts are too", () => {
  for (const workflow of [backup, release]) {
    const paths = [...workflow.matchAll(/^ {10}path: (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(paths, ["backup/*.gpg"]);
    assert.match(workflow, /^ {10}if-no-files-found: error$/m);
    assert.match(workflow, /^ {10}retention-days: 90$/m);
  }
  // The script refuses to finish with a plain file in the upload folder, and checks each upload is a public-key message.
  assert.match(script, /^only_encrypted\(\) \{$/m);
  assert.match(script, /find "\$dir" -type f ! -name '\*\.gpg'/);
  assert.match(script, /'\^:pubkey enc packet:'/);
  assert.match(script, /^ {2}only_encrypted "\$out"$/m);
  // The plain dump is written to a temporary folder that is removed, never to the folder given.
  assert.match(script, /^ {2}dump "\$WORK\/portal-data\.sql" "\$@"$/m);
  assert.match(script, /^trap 'rm -rf "\$WORK"' EXIT$/m);
});

test("a release backs up before it migrates, and a failed backup stops the migration", () => {
  const order = steps(release);
  const backUp = order.indexOf("Back up the data before migrating");
  const keep = order.indexOf("Keep the backup for 90 days");
  const apply = order.indexOf("Apply them");
  assert.ok(backUp > 0 && keep > backUp && apply > keep, order.join(" | "));
  // No `if` on the migration: it runs only when every step before it passed.
  assert.match(release, /^ {6}- name: Apply them\n {8}run: npx supabase db push --remote --yes$/m);
  assert.match(
    release,
    /^ {8}if: steps\.pending\.outputs\.any == 'true' && vars\.BACKUP_PUBLIC_KEY != ''\n {8}run: bash scripts\/backup\.sh encrypted backup --remote$/m,
  );
  // Without a key the migration still runs, and the run says there was no copy.
  assert.match(
    release,
    /^ {8}if: steps\.pending\.outputs\.any == 'true' && vars\.BACKUP_PUBLIC_KEY == ''\n {8}run: echo "::warning title=No backup before migrating::/m,
  );
  // Vercel is told either way, so a failed backup never lets the new deployment go live.
  assert.match(release, /^ {6}- name: Tell Vercel how it went\n {8}if: always\(\)$/m);
});

test("CI proves a copy restores, last in the job because the drill wipes the database", () => {
  const order = steps(ci);
  const drill = order.indexOf("Restore drill");
  assert.ok(drill > order.indexOf("End-to-end, accessibility and screenshots"), order.join(" | "));
  assert.ok(drill > order.indexOf("Keep every page as the owner sees it, for R&D (e2e/page-shots.spec.ts)"));
  assert.match(ci, /^ {6}- name: Restore drill\n {8}run: bash scripts\/backup\.sh drill$/m);
  // The drill never runs against a real database.
  assert.match(script, /\[ -z "\$\{RESTORE_DB_URL:-\}" \] \|\| fail "the drill wipes its database/);
});

test("the book's pages never leave in a copy, and a restore is all or nothing", () => {
  assert.match(script, /^BOOK_TABLES="portal\.book_pages,portal\.book_sections"$/m);
  assert.match(script, /--data-only --use-copy --schema portal --exclude "\$BOOK_TABLES"/);
  assert.match(script, /echo "BEGIN;"\n\s+echo "TRUNCATE \$tables CASCADE;"/);
  assert.match(script, /echo "COMMIT;"\n\s+\} \| run_sql -q -v ON_ERROR_STOP=1/);
});
