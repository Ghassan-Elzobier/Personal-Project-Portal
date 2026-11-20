# Backups, and the way back

The live database is on Supabase's Free plan, which keeps no backups. The portal
keeps its own.

## What is kept

- **Every night** (02:17 UTC), the Backup workflow copies the portal's data.
- **Before every migration**, the Release workflow takes the same copy first. If
  the copy fails, the migration does not run and the old deployment keeps
  serving. A merge with no migration takes no copy.
- Each copy is kept for **90 days**, as an artifact of its run: Actions, then
  Backup (or Release), then the run, then Artifacts.
- **Each copy is encrypted to your public key before it is uploaded.** This
  repository is public, so anyone can download the encrypted file. Only your
  private key can open it, and that never leaves your machine.

Not in a copy:

- **Sign-in accounts.** Supabase keeps those in its own `auth` schema. Restoring
  into the same project needs nothing more. A new project needs one extra step
  (below).
- **The book's pages.** They come from your own PDF: load them again with
  `npm run load:book`.

**Is it proven?** Yes, on every pull request. CI's restore drill backs up its
database the way production is backed up (encrypted, to a key made for the
drill), wipes it, restores it and compares every row and counter. Run it yourself
with `bash scripts/backup.sh drill`, on a local stack you don't mind wiping.

## One-time setup

Nothing is backed up until this is done. Until then the Backup workflow is
skipped, and a release that migrates says "No backup before migrating".

1. Make a key pair for backups. Pick a passphrase when it asks:

   ```sh
   gpg --quick-generate-key "Portal backups" default default never
   ```

2. Give the repository the public half:

   ```sh
   gpg --armor --export "Portal backups" | gh variable set BACKUP_PUBLIC_KEY
   ```

3. Keep the private half somewhere that survives this machine: a password manager.
   **If you lose it, no backup can be opened.**

   ```sh
   gpg --armor --export-secret-keys "Portal backups" > portal-backups-private.asc
   # store the file and the passphrase in your password manager, then:
   rm portal-backups-private.asc
   ```

4. Take the first copy and look for its artifact:

   ```sh
   gh workflow run backup.yml
   gh run list --workflow backup.yml --limit 1
   ```

## Restoring

A restore empties every table in the copy and loads the copy, in one transaction:
it restores everything or changes nothing. **Anything saved after the copy was
taken is lost**, so check the copy's time first (it is in the file's name, in UTC).

### 1. Get the copy and open it

```sh
gh run list --workflow backup.yml          # or: --workflow release.yml, for the copy before a migration
gh run download <run id> --dir restore
gpg --output portal-data.sql --decrypt restore/*/portal-data-*.sql.gpg
```

### 2. Look at it locally first

```sh
npm run db:start
bash scripts/backup.sh restore portal-data.sql
```

That loads it into the local stack, which is safe to get wrong. Open the portal
locally and check it is the data you expect.

### 3. Load it into the live database

Copy the connection string from the Supabase dashboard (Connect, then Session
pooler), with the database password in it. The local stack must be running: its
database container lends the `psql` that does the loading.

```sh
RESTORE_DB_URL='postgresql://…' bash scripts/backup.sh restore portal-data.sql
```

Then delete `portal-data.sql`: it is your data in plain text.

### If the project itself is gone

A new Supabase project has new sign-in accounts, so your rows would point at an
account that no longer exists.

1. Create the project and apply the migrations (`docs/LAUNCH.md`, section 1), and
   point Vercel at it.
2. Sign in to the portal once. It will say you have no access: that sign-in made
   your new account.
3. Copy the new account's id from the Supabase dashboard (Authentication, then
   Users, then User UID).
4. Restore with it. Every row that pointed at your old account now points at the
   new one:

   ```sh
   RESTORE_DB_URL='postgresql://…' bash scripts/backup.sh restore portal-data.sql --owner <the new id>
   ```

5. Load the book again (`npm run load:book`). Invite mentors again from People,
   and connect Google Calendar and Claude again if they ask.

## What can go wrong

- **"BACKUP_PUBLIC_KEY is not a public key gpg can read."** The variable holds
  something else. Do step 2 of the setup again.
- **"the local database is not running."** `npm run db:start`.
- **The restore stops with an error.** Nothing changed: it is one transaction.
  The usual cause is a copy older than a migration that renamed or dropped a
  column, so the copy no longer fits the tables. Bring the copy forward on the
  local stack first. The drill does not rehearse this path, so go step by step:
  1. Check out the commit the copy was taken at (the Release artifact is named
     after it) and run `npx supabase db reset --no-seed`.
  2. `bash scripts/backup.sh restore portal-data.sql`.
  3. Check out main and run `npx supabase db push`, which applies the newer
     migrations to the restored data.
  4. `bash scripts/backup.sh dump portal-data.sql` writes a copy that fits. Restore
     that one into the live database.
