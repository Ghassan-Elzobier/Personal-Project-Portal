# Launch checklist (for Claude Code in VS Code)

Ask Claude Code: **"Follow docs/LAUNCH.md and take the portal live with me."**

This is the order to take the portal from `main` to a live site with the
Claude connector working. The details for each step are in
[SETUP.md](SETUP.md); this file adds the order, the checks and the rules.

## Rules for the agent

- **The repo is public.** Never commit a secret or write one to a tracked
  file. Secrets go in `.env.local` (gitignored) and in Vercel's environment
  variables only. Before any commit, run `git diff --cached` and check that it
  contains no tokens, keys, passwords or mentor emails.
- **Personal only.** Use Ghassan's personal Supabase org, personal Asana
  workspace and personal Google account. Never touch Neubond or any work
  workspace, and never read work Asana data.
- **Ask first** before creating anything paid, before deleting anything, and
  before every browser sign-in (Ghassan does the sign-in himself).
- **Stop and show the output** if a command fails. Don't work around a
  failure by changing migrations or turning off checks.
- Tick each box in your own reply as you go so Ghassan can see where you are.

## 0. Prepare

- [ ] On an up-to-date `main` (`git pull`), run `npm install`, then
      `npm run lint`, `npm run typecheck` and `npm test`. All must pass.
- [ ] Check the tools: `node -v` (22 or newer), `npx supabase --version`,
      `npx vercel --version`, `openssl version`.
- [ ] `cp .env.example .env.local`. Fill it in as you go.

## 1. Supabase (SETUP.md section 2)

- [ ] `npx supabase login` (browser sign-in).
- [ ] Create the project in the **personal** org: dashboard, or
      `npx supabase projects create personal-project-portal`. Ask for the
      region (closest to London) and the plan (Free).
- [ ] `npx supabase link --project-ref <ref>`, then `npx supabase db push`.
      It should apply seven migrations: portal access, Google Calendar,
      Claude connector, native tasks, bulk reads, study and the PMPP correction.
- [ ] `npx supabase config push` applies sign-ups off and the auth settings.
- [ ] If Docker is running, `npx supabase test db`. 106 pgTAP checks should pass.
- [ ] Copy the project URL and anon key into `.env.local`
      (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- [ ] Ghassan invites his own email under Authentication, then Users, then
      Invite user, and accepts the email.
- [ ] Run the owner insert from SETUP.md in the SQL editor, or with
      `npx supabase db query` if available. Check it with
      `select role, display_name from portal.members;`. It should show one
      owner row.

## 2. Asana (SETUP.md section 1)

Skip this step unless Ghassan wants `TASK_BACKEND=asana`. By default tasks live
in Supabase, on the portal's Tasks page, and no Asana values are needed. Later
steps that mention Asana then apply to the Tasks page instead.

- [ ] Ghassan creates a personal access token in his **personal** Asana and
      pastes it into `.env.local` himself as `ASANA_TOKEN`. Don't echo it back.
- [ ] List workspaces:
      `curl -s -H "Authorization: Bearer $ASANA_TOKEN" https://app.asana.com/api/1.0/workspaces`.
      Ghassan confirms which one is personal, and that gid goes in
      `ASANA_WORKSPACE_GID`.
- [ ] List that workspace's projects
      (`/api/1.0/projects?workspace=<gid>&archived=false`). Set the gids for
      PMPP 5e, Axler LADR, the Rendering lab and the Weekly log.
- [ ] For each project, check the custom fields Stage, Hours and Evidence
      exist (`/api/1.0/projects/<gid>/custom_field_settings`). List any that
      are missing for Ghassan to add.
- [ ] Set `PORTAL_TIMEZONE=Europe/London`, and `PORTAL_WEEKLY_HOURS_TARGET`
      if he wants one.

## 3. Google (SETUP.md section 3 and "Google sign-in")

These steps are in the browser, so guide Ghassan through them.

- [ ] Create a Google Cloud project, enable the Google Calendar API, and set
      up the consent screen: External, his Gmail as a test user, the
      `calendar.events` scope, then **Publish app**.
- [ ] Create a Web OAuth client with these redirect URIs:
      `http://localhost:3000/api/google/callback`, and
      `https://<project-ref>.supabase.co/auth/v1/callback`. The production
      callback is added after step 4.
- [ ] Put the client id and secret in `.env.local`, and generate
      `GOOGLE_TOKEN_KEY` with `openssl rand -base64 32`.
- [ ] Turn on the Google provider in Supabase with the same client. Use the
      dashboard, or `npx supabase config push` with `GOOGLE_CLIENT_ID` and
      `GOOGLE_CLIENT_SECRET` exported in the shell.
- [ ] Set `GOOGLE_SIGN_IN=on`.

## 4. Try it locally

- [ ] `npm run dev`, then open http://localhost:3000. Sign in, with Google and
      with an email link.
- [ ] Today loads and **Needs attention** names no missing setting.
- [ ] Open **Study** and load each plan.
- [ ] Schedule, then **Connect Google Calendar**. Drag one task onto the week,
      and check its start and due time in Asana. Then add and delete a lunch
      block.
- [ ] Log a 0.25 h test session and check the comment in Asana. Delete the
      comment afterwards if he wants.

## 5. Vercel (SETUP.md section 4)

- [ ] `npx vercel login`, then `npx vercel link`. Ghassan confirms the
      personal scope or team and the project name.
- [ ] Add every variable from `.env.local` to Production with
      `npx vercel env add <NAME> production`. Set `NEXT_PUBLIC_SITE_URL` to
      the production URL, not localhost.
- [ ] Leave out the dev-only overrides (`ASANA_API_BASE`, `GOOGLE_*_URL`,
      `GOOGLE_API_BASE`).
- [ ] `npx vercel --prod`. Note the production URL.
- [ ] Add the production URLs:
  - Supabase, Authentication, then URL Configuration: Site URL
    `https://<domain>`, plus the redirect `https://<domain>/auth/callback`.
  - Google OAuth client: `https://<domain>/api/google/callback`.
- [ ] Redeploy if any variable changed after the first deploy.

## 6. Check the live site

- [ ] Sign in on the live URL. Today shows no missing settings.
- [ ] Connect Google Calendar on the live Schedule page. The refresh token
      from localhost is per-site, so connect again here.
- [ ] Add a mentor only if Ghassan asks now. If so, invite them in Supabase
      first, then add them on People.

## 7. Claude connector (SETUP.md section 5)

- [ ] Open `/claude` on the live site and copy the connector URL.
- [ ] In claude.ai, go to Settings, then Connectors, then Add custom
      connector. Name it Portal, paste the URL, press Connect, then **Allow**
      on the portal page.
- [ ] In a Claude chat with the connector on, ask "what's on today?". It
      should call `get_today` and list today's tasks.
- [ ] Paste the line from `/claude` into the GPU programming Claude project's
      instructions.

## Done

Report back:

- the production URL;
- which boxes are ticked;
- anything skipped and why;
- any Asana fields that are missing.
