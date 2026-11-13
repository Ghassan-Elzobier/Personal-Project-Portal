# Setting up the portal

You need a Supabase project and a Vercel account. Tasks live in Supabase by
default, so Asana is optional: section 1 applies only with `TASK_BACKEND=asana`.
Nothing secret goes in the repo. Every value below goes in `.env.local` for
local work and in Vercel's environment variables for the live site.

## 1. Asana (optional, personal workspace only)

Skip this section to keep tasks in Supabase. To use Asana, set
`TASK_BACKEND=asana` and follow these steps. The Tasks page is then hidden, and
existing tasks are not copied across.

1. Sign in to your **personal** Asana account, not the work one.
2. Create a personal access token: profile picture, then My settings, then
   Apps, then Manage developer apps, then Create new token. Put it in
   `ASANA_TOKEN`. Treat it like a password; anyone with it can act as you in Asana.
3. Find the workspace gid: open
   `https://app.asana.com/api/1.0/workspaces` while signed in and copy the
   `gid` of your personal workspace into `ASANA_WORKSPACE_GID`.
4. For each project, open it in Asana. The long number in the URL is its gid.
   Set `ASANA_PROJECT_PMPP`, `ASANA_PROJECT_AXLER`,
   `ASANA_PROJECT_RENDERING` and `ASANA_PROJECT_WEEKLY_LOG`.
5. Make sure each project has the custom fields **Stage** (single-select:
   Not started, In progress, Blocked, Needs review, Done), **Hours** (number)
   and **Evidence** (text). Phase and Type are shown when present.

The portal checks every project's workspace against `ASANA_WORKSPACE_GID` and
refuses to read or write any project outside it, so a wrong gid cannot pull in
work data.

## 2. Supabase

With the Supabase CLI, pinned in `package.json` (v3: commands act on the local
stack unless given `--remote`, and hosted changes ask first):

```sh
npx supabase login
npx supabase projects create personal-project-portal   # or create it in the dashboard
npx supabase link --project-ref <ref>
npx supabase db push --remote     # first setup only; after that CI applies migrations on merge
npx supabase config push --yes    # applies auth settings from supabase/config.toml
```

Then in the dashboard:

1. Project Settings, then API: copy the URL and the anon key into
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Authentication, then URL Configuration: set Site URL to your Vercel URL,
   and add `https://<your-domain>/auth/callback` and
   `http://localhost:3000/auth/callback` to Redirect URLs.
3. Authentication, then Users, then Invite user: invite yourself. Accept the
   email.
4. SQL editor: make yourself the owner (the only manual SQL step):

   ```sql
   insert into portal.members (account_id, role, display_name)
   select id, 'owner', 'Ghassan' from auth.users where email = '<your email>';
   ```

5. Mentors: invite each one from Authentication, then Users, then add them on
   the portal's **People** page with the projects they should see. Their names
   and emails live only in the database.

Sign-ups are off. The sign-in form never creates accounts, so only people you
invite can get a link.

Database tests (pgTAP) run with `supabase test db`.

## 3. Google Calendar (life blocks and study time)

Lunch, cooking, cleaning, gym and rest live in Google Calendar, never in
tasks, so mentors never see them. Study time goes there too: each task's slot
is copied to the calendar whenever it is scheduled, and extra study sessions
on a task are kept there only. After connecting, press **Sync study to
Google** on the Schedule page once to copy slots made earlier.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project (for example "personal-portal") with your personal Google account.
2. APIs and Services, then Library: enable the **Google Calendar API**.
3. OAuth consent screen: User type External, add your Gmail as a test user,
   and add the scope `.../auth/calendar.events`. Leaving the app in "Testing"
   is fine for one user, but Google then expires the connection after 7 days;
   click **Publish app** to keep it. Google then shows an "unverified app"
   warning when you connect, which you can click through; verification is only
   needed for apps used by other people.
4. Credentials, then Create credentials, then OAuth client ID, type Web
   application. Authorised redirect URIs:
   `https://<your-domain>/api/google/callback` and
   `http://localhost:3000/api/google/callback`.
5. Put the client id and secret in `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, and a fresh key in `GOOGLE_TOKEN_KEY`
   (`openssl rand -base64 32`). Optionally set `GOOGLE_CALENDAR_ID` to a
   dedicated "Life" calendar's id (Calendar settings, Integrate calendar).
6. Run `supabase db push` again for the Google migration, deploy, open
   **Schedule** and click **Connect Google Calendar**.

### Google sign-in

The same OAuth client also signs you and your mentors in with Google.

1. In the OAuth client from step 4, add one more authorised redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase shows it
   under Authentication, then Sign In / Providers, then Google).
2. In Supabase, open that Google provider, turn it on, and paste the same
   client id and secret. With the CLI, `supabase config push` does it from
   `supabase/config.toml` when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   are set in your shell.
3. Set `GOOGLE_SIGN_IN=on` in Vercel and redeploy.

Sign-ups stay off, so a Google account only gets in if its email was invited
first. Invite mentors by the Gmail address they will sign in with. Email links
still work for anyone without Google. Sign-in asks Google only for name and
email; calendar access is the separate Connect button, for you alone.

With `TASK_BACKEND=asana`, Asana's own calendar sync is no longer needed,
since the portal copies study slots itself. Leave it off to avoid seeing each
block twice.

How scheduling works: dragging a task onto the week sets its start and due
time in Asana. Remove time puts it back to a plain due date on that day.

## 4. Vercel

1. Import the GitHub repo in Vercel. The defaults for Next.js are right.
2. Add every variable from `.env.example` under Settings, then Environment
   Variables. Set `NEXT_PUBLIC_SITE_URL` to the production URL so magic links
   point at it.
3. Deploy, sign in, and check the **Needs attention** list on Today. It names
   any variable that is missing.

The repo's `vercel.json` runs the server in London (`lhr1`), next to the
Supabase project. Keep them in the same region: pages make several database calls,
and each one crosses that distance. If your Supabase project is elsewhere, change it.

## Study plans

Open **Study** and load the plans. It adds each book's structure and the renderer's
milestones as sections and tasks, with steps, exercises and things to recall.
Loading again only adds what is missing and never changes existing work. Then set a
pace on the roadmap, which dates all three plans together.

To change a plan, edit `src/lib/study`. New units arrive when you press "Add
missing", and links and prerequisites show straight away. Text already loaded stays
as it is, so changing the meaning of a `ref` needs a migration like
`20261105130000_pmpp_fifth_edition.sql`.

Do not add a `loading.tsx` or a `<Suspense>` boundary to a page that saves things
without testing it repeatedly: see the note in `src/components/link-pending.tsx`.

## The book and the Lab

The Lab works as soon as the portal is deployed. The book needs your PDF, once:

1. `supabase db push` applies `20261111120000_library.sql`, which adds the page tables, the search RPCs and the private `library` bucket.
2. Install pdftotext if you do not have it: `sudo apt install poppler-utils`.
3. From the portal's folder: `npm run load:book -- "/path/to/your PMPP.pdf"`. It reads the PDF, labels each page with its chapter and section, and loads about 1,700 pages into the linked database in a minute or so. The index pages are left out. Add `--local` to load a local database instead. Running it again replaces the pages.
4. Open `/library` and use **Choose the PDF** to put the file in the private bucket. Search works without it; with it, every page number in the portal opens the PDF at that page.

## 5. Claude connector (after Vercel)

This lets you plan, schedule and log by asking Claude in the Claude app, on
your Claude subscription. Claude's servers call the portal, so it needs the
deployed URL; it can't reach `localhost`.

1. Make sure the Claude connector migration is applied
   (`supabase db push` applies every file in `supabase/migrations`), and that
   `NEXT_PUBLIC_SITE_URL` is set in Vercel.
2. Sign in to the portal and open **Claude** in the nav. Copy the connector URL
   (`https://<your-site>/api/mcp`).
3. In Claude (claude.ai), go to Settings, then Connectors, then **Add custom
   connector**. Name it Portal, paste the URL, and press Connect. Leave the
   advanced OAuth fields empty.
4. The portal asks you to allow it. Press **Allow**.
5. In the GPU programming Claude project, add the line shown on the Claude page
   to the project instructions.

Only the owner can approve a connection, and only Claude's own callback
(`claude.ai` / `claude.com`) is accepted as a redirect. Claude asks before
every change it makes. **Disconnect everything** on the Claude page revokes all
tokens at once.

## Local development

```sh
cp .env.example .env.local   # fill it in
npm install
npm run dev
```

Checks: `npm run check`, then `npm run test:e2e` and `npm run test:db` (docs/FACTORY.md).

To try the connector locally, point an MCP client such as the MCP Inspector at
`http://localhost:3000/api/mcp`. Under `next dev`, localhost redirect URIs are
accepted for OAuth; production accepts only Claude's.
