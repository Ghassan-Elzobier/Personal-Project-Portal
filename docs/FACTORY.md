# The software factory

How changes get made in this repository: you say what you want, an agent builds
it inside a harness of rules and checks, and you review a pull request that has
already proved itself. The harness also keeps the design cohesive, works the
code's structural debt down every week, improves itself from what goes wrong,
and researches what to improve next, four times a day.

It is built for one owner on a Claude Max subscription, GitHub, Vercel and
Supabase, and it follows the published practice for agent-driven development
(sources at the end).

## Using it

Four ways in, all running the same factory: the same `AGENTS.md`, rules, skills,
hooks and checks, because all of them live in this repository.

| Where you are | What you do | What happens |
| --- | --- | --- |
| Terminal or VS Code | Ask for the change. Big ones: plan mode first (Shift+Tab). | Claude follows `/ship`: branch, build, verify, pull request, CI green. |
| Phone or browser | Start a task at claude.ai/code or in the Claude app's Code tab. | A cloud session does the same, then turns on auto-fix for its PR. |
| GitHub | Open an issue from a template and write `@claude` in it, or comment `@claude` on a PR. | The Claude workflow does the work and answers in the thread. |
| Nothing | The weekly routines run on their own (setup below). | A refactor PR and a factory-improvement PR, when there is something worth doing. |
| Nothing: the live portal hits an error | The error triage runs every 30 minutes. | A bug issue for the error, and a fix PR from Claude ("Errors become fixes" below). |
| Nothing: R&D runs four times a day | Each run takes one focus and researches how that part of the portal or the factory could be better ("Research and development" below). | An `rnd` issue with one proposal, its evidence and its sources, when one is worth your time. Build it by asking Claude on the issue; decline it by closing it as not planned. |

You review and merge. Merging deploys: the release workflow migrates the
database, and Vercel waits for it before the new version goes live.

Skills you can call by name: `/ship` (any change), `/design` (UI), `/refactor`
(structure only), `/migrate` (database), `/improve-factory` (the weekly pass).
You rarely need to: `AGENTS.md` carries the essentials into every session, which
evaluations show works better than relying on an agent to pick a skill. Agents
you can ask for by name: `verifier`, `debugger` and `rnd` ("ask the rnd agent how
the gym page could work better").

## How quality is kept

Checks run from cheapest to dearest, as early as possible ("keep quality left"),
and computational checks come before AI judgement:

| When | Check | Catches |
| --- | --- | --- |
| Every edit | Hook: Prettier on the file | Style, so it never costs a review |
| Before Claude may finish | Stop hook: format, lint, types, unit tests on changed code | Broken work handed back as done |
| Before a PR | `npm run check`, `npm run test:e2e`, `npm run guard` | The same as CI, locally |
| Every PR | CI **Checks**: format, lint (design and architecture rules), types, 268 unit tests, dead code | Regressions, one-off styles, boundary breaks, unused code |
| Every PR | CI **Integration**: 193 database tests, every page at Pixel 7, 360 px and desktop, accessibility, screenshots | Broken pages, sideways scrolling, access leaks, visual change |
| Every PR | **Guard**: migrations append-only, ratchets only tighten, existing tests need your label to change | An agent getting to green by weakening the checks |
| Every PR, on every push | Claude review, in a fresh session that did not write the code. It ends in a comment naming the commit it covered, and the check fails without one | Logic and design problems the checks can't see |
| Merge | Release: migrate production; Vercel Deployment Checks hold the deploy until "Production database migrated" passes | Code going live before its database |
| Weekly | Dependabot, CodeQL, secret scanning with push protection | Vulnerable dependencies, leaked keys |
| Hourly | Error triage: production errors filed as issues and handed to Claude | Bugs no check caught, found by real use |

Two rules make the checks trustworthy. Existing tests and screenshots are your
acceptance checks: an agent may add them but not change them without your
`approved-test-change` label (the same reason StrongDM keeps its scenarios out of
the agents' reach). And the ratchets (`eslint-suppressions.json`,
`e2e/a11y-baseline.json`) only shrink.

## Design that stays cohesive

The design system is code, and it is enforced:

- **Tokens** in `src/app/globals.css`: the palettes, the type and the shared
  utility classes (`card`, `btn-primary`, `field-input`, ...).
- **Components** in `src/components/ui.tsx` and `src/app/life/parts.tsx`.
- **`/design`**, a page showing every token and component in its states. It is
  the reference for new UI, and it is screenshotted at three sizes, so changing a
  shared piece shows up in review as an image diff.
- **Lint rules** reject unknown, conflicting or deprecated classes, raw hex
  colours and one-off pixel sizes, with a message saying what to use instead.
- **Phone-first checks**: every page is opened at 412 px and 360 px and fails if
  anything crosses the main column.

The `/design` skill tells agents to start from what exists and to promote a
pattern used twice into a shared component on `/design`. `docs/DESIGN.md` holds
the reasoning.

## Errors become fixes

The checks catch what someone thought to test, and production finds the rest. So
the portal reports its own errors, and the factory turns them into fixes:

1. **Capture.** In production, server errors (`src/instrumentation.ts`), browser
   errors (`src/instrumentation-client.ts` and the error pages) and connector tools
   that fail are reported to `src/lib/errors`. Noise is dropped: network failures,
   chunks from an old deployment, browser extensions, aborted requests.
2. **Context, as Sentry gives it.** Each occurrence keeps:
   - its stack, mapped back to source lines by the build's own source maps
   - the browser, system and kind of device (the raw user agent is not kept)
   - the last thirty breadcrumbs: navigations, clicks (the element and its
     design class, never its text), requests and console errors

   The source maps are never served, and hold no source code. After the build,
   `scripts/pack-source-maps.mjs` moves the browser's maps out of the public
   files, strips the source text from every map (a frame needs only positions
   and file names), and adds each map to the server functions that need it; `src/proxy.ts` refuses any `.map` request as
   well, and an e2e check holds it there. So frames stay readable even if the
   repository goes private.
3. **Scrub and group.** The issues are public, so anything that could be personal
   is removed before a report is stored: quoted free text, emails, ids, dates,
   tokens, long numbers, hosts, query strings and Postgres value lists. The error
   type, its wording, code identifiers, the route pattern and the stack frames
   stay. Each bug is one row in `portal.error_groups`, with its last 30
   occurrences in `portal.error_events` and daily counts in `portal.error_daily`.
   Error messages put variable values in quotes so the scrubber can find them, and
   a lint rule (`portal/quoted-error-values`) enforces it.
4. **Triage, every 30 minutes** (`.github/workflows/error-triage.yml`, running
   `scripts/error-triage.mjs`, no AI). A new bug becomes an issue labelled
   `error-report`, with links to the source lines at that release, the device,
   and the breadcrumbs. An open issue gets its counts updated. A closed issue
   reopens when the error comes back on code that contains the fix; an old tab
   still running old code does not count. GitHub's notifications bring each new
   issue to your phone.
5. **Fix.** New and returning bugs go to Claude, one at a time and at most two a
   day. It follows `/ship` and opens a PR saying `Fixes #N`, which then goes through
   CI, the guard and the review like any other. If there's nothing to fix in the
   code (an outage, say), it says why on the issue and closes it as not planned.

**The errors page** (`/errors`, under More, owner only) shows it all without
GitHub: every bug with its 14-day trend, and for each one its stack linked to the
source at that release, the breadcrumbs, recent occurrences and the devices it
hit. **Send a test error** throws a real error on the server or in the browser and
sends it through the whole pipeline, so you can see a stack arrive mapped. Test
errors stay on the page and are never filed.

You stay in charge with two labels, the close button and the page. `no-autofix`
keeps an issue from Claude. Closing an issue as not planned, or pressing Ignore on
the errors page, stops the triage reporting that error; the triage closes or
reopens the GitHub issue to match the page. The repository variable `ERROR_AUTOFIX_PER_DAY` sets the daily limit
(5 when it isn't set, the workflow's fallback for the Max plan; at most 10); `0` turns auto-fixing off.

If the repository goes private, change the triage's schedule back to hourly
(`17 * * * *`). Private repositories get 2,000 free Actions minutes a month, and
running every 30 minutes uses about 1,440 of them. Nothing else changes.

## When CI fails, something looks into it

A failed check on a pull request is investigated before you have to (`.github/workflows/ci-triage.yml`,
`scripts/ci-triage.mjs`, no AI for the first step):

1. **Read the log.** `src/lib/ci/failure.ts` names what failed (end-to-end, database, types,
   lint, format, guard) or recognises an infrastructure flake: a port already in use on the runner,
   a registry timeout, a rate limit. It is tested against logs that really failed.
2. **Flake: rerun once,** and say why on the pull request.
3. **Real failure: a comment** with what failed and the lines that show it.
4. **On your own `claude/` branches, Claude repairs it** and pushes to the same branch, at most twice
   per pull request, following `/debug`. It may not weaken, skip or re-record a test. The guard failing
   is never auto-fixed: that needs your label. Label a pull request `no-autofix` to keep it for yourself.

**When another pull request merges, the rest are checked for conflicts** (`.github/workflows/pr-conflicts.yml`).
GitHub only shows a conflict on the pull request itself, so on every push to main the workflow looks at
each open pull request, says which files now conflict, and on your own `claude/` branches has Claude merge
main in, resolve it and push, twice at most. The friction log is the usual culprit: every pull request
appends to its end, and the resolution is always to keep every line.

Fork pull requests are never touched, and the log is read as data. The Integration job also retries
starting the database itself, since a port clash there failed two pull requests in a row.

## Debugging like a person

A bug is fixed by seeing it fail, not by guessing. `/debug` (and the `debugger` agent) set the order:
reproduce it as a failing end-to-end test, stop at the failure and look, find the cause, fix the app,
prove the test fails without the fix. The tools, chosen from what each is best at:

| Tool | Used for |
| --- | --- |
| **Playwright test MCP** (`playwright-test`) | Run tests; `test_debug` pauses at the failure, then read the page, state (`browser_evaluate`), console and network. Its planner, generator and healer agents live in `.claude/agents/`. |
| **Chrome DevTools MCP** (`chrome-devtools`, pinned) | Runtime detail Playwright lacks: source-mapped logpoints, performance traces at Pixel 7 emulation, heap snapshots, Lighthouse. Your phone runs Chrome, so it is the right engine. |
| **Next.js DevTools MCP** (`next-devtools`) | The dev server's errors, with source-mapped stacks. |

`npm run debug` starts the app on the seeded local database (the dev server: source maps and hot
reload), and `npm run debug:link` prints a one-time signed-in link for the debugging browser. Both
are local only; the link script refuses any database that is not local. Chrome DevTools MCP runs
isolated and headless, without usage statistics, and cannot open `file:` URLs.

The servers are started through `scripts/mcp.sh`, which puts the Node in `.nvmrc` on the path first
(the same lookup the session hooks use). Claude Code launches MCP servers with the host's own `node`,
often the system's Node 18, and all three servers need Node 20 or newer: without the wrapper each one
shows "Connection closed". If a server fails to connect, run its command from `.mcp.json` by hand.

**The healer cannot cheat.** Playwright's healer edits failing tests until they pass, or marks them
`test.fixme()`. Here the guard fails any added `fixme`, `only` or unconditional skip in an e2e spec
unless you add `approved-test-change`, whether the test is old or new, and editing an existing test
already needed that label. So an agent can only get to green by fixing the app. Regenerate the
agent files after a Playwright upgrade (`npx playwright init-agents --loop=claude`; it rewrites
`.mcp.json`, so merge it).

Not used, on purpose: Replay.io (time travel; a cloud service, its MCP is experimental), Firefox
DevTools MCP and agent-browser (Playwright already covers Firefox and WebKit), and server step
debuggers (community-built and alpha for JavaScript). Revisit Replay if a bug resists all of this.

## Refactoring, every week

Structure decays unless something pushes back, so refactoring is part of the
loop, not a someday task:

1. **The queue.** `npm run health` ranks what needs work: suppressed rule
   breaches by rule and file, unused code (knip), accessibility findings, and
   hotspots (big files that change often, the method from Tornhill's *Your Code
   as a Crime Scene*). `refactor` issues come first.
2. **The ratchet.** New code must follow every rule; old breaches are recorded and
   can only go down. The guard fails any PR that grows them.
3. **The proof.** A refactor changes no behaviour, so every test passes unchanged
   and every screenshot stays pixel-identical. The first refactor in this
   factory (canonical Tailwind classes and palette tokens across 35 files) passed
   that way, taking the queue from 361 to 247.
4. **The run.** A weekly routine runs `/refactor`, which takes the top of the
   queue and opens one small PR. You merge it like any other.

## A factory that improves itself

The harness (rules, skills, hooks, checks, docs) is improved the same way the
code is, from evidence:

1. **Capture.** Whoever hits friction (a missing rule, a flaky check, a mistake
   that got through) adds one line to `docs/factory/friction.md` in the same PR.
   `/ship` asks for it at the end.
2. **Reflect, weekly.** `/improve-factory` reads the open friction, the week's
   review comments and failed checks, and the metrics. It keeps only what
   repeated or reached production.
3. **Curate, in small deltas.** At most three changes, each the cheapest control
   that would have prevented the problem: a lint rule, test or guard check
   first, then one line in a rule file or skill. Never a wholesale rewrite.
4. **Validate.** Each change cites its evidence and passes the full suite, and
   you merge it. The factory may never loosen its own checks.
5. **Measure.** `npm run factory:metrics` adds a row to `docs/factory/metrics.md`:
   CI first-try rate and review notes (does work arrive ready?), the queue size,
   and the test count.

This follows the research on self-improving agents. Agentic Context Engineering
(ICLR 2026) found that playbooks improve when updated by small itemised deltas
and collapse when rewritten wholesale. The Darwin Gödel Machine and SICA showed
that self-modification only helps when every change is validated against real
results and kept in an archive (here, git and the PRs). Böckeler's harness
engineering adds the steering loop: when something goes wrong twice, improve the
guides or sensors, preferring computational ones.

## Research and development, four times a day

The checks keep what exists working; R&D looks for what would make it better.
It works towards the goal in `AGENTS.md`: a portal that runs your week, making
your studies, job hunt, scheduling, gym routine, budgeting and food intake
better, where every visit gives you what you need in the fewest taps.

1. **One focus a run.** Fifteen take turns (`src/lib/rnd/foci.ts`), and each day
   mixes what you see with how it is built: design, navigation (the taps a job
   takes, and whether each screen shows what matters at that moment), one portal
   (how the spaces work together), performance, security, reliability (what
   would fail with nobody noticing), code, the factory, the Claude connector
   (what you can do by asking Claude), and study, the job hunt, schedule, gym,
   food and money. At four runs a day, each focus comes round about every four
   days. Every tool in the nav is some focus's own page, and a test holds that,
   so a new tool arrives with a focus.
2. **Evidence first, gathered by scripts.** Before Claude starts,
   `scripts/rnd.mjs brief` writes `.rnd/brief.md`: what changed lately, every open
   proposal and the ones you decided on this focus with your reasons, the
   refactor queue, `npm audit` or outdated packages where they matter, and every
   page as you see it on a Pixel 7. CI captures those pages on each merge
   (`e2e/page-shots.spec.ts`, kept 14 days as the `page-shots` artifact), with
   facts for each: taps from Today, screens long, tap targets under 24 and 48 px,
   links, words, JavaScript and LCP.
3. **A method from the research.** The `rnd` agent (`.claude/agents/rnd.md`)
   looks at the code and the pages, reads two to six sources (standards and
   official docs first, then peer-reviewed studies, then recognised practice),
   generates three candidates, critiques and scores each, and keeps the best: the
   generate, critique and rank loop of Google's AI co-scientist, on a small
   scale. Each focus starts from named research, from Nielsen's heuristics and
   Material Design 3 to the learning-science reviews, the ACSM progression
   stand, the ISSN on protein, OWASP ASVS and Core Web Vitals.
4. **One proposal, or none.** A proposal becomes an `rnd` issue: the problem, the
   evidence linked to the lines it read, what the research says, the smallest
   change, "done when" checks, what else it weighed, and the risks. New evidence
   for an open proposal is added to that issue instead. When nothing clears the
   bar it files nothing.
5. **You decide.** Build a proposal by asking Claude on its issue (`@claude build
   this`); it follows `/ship` like any other change. Decline one by closing it as
   not planned, with a reason if you have one: the next run on that focus reads
   it and won't bring the idea back without evidence that answers you. While
   eight proposals wait, R&D pauses itself, so it never runs ahead of your decisions.

In a session, ask for it by name ("ask the rnd agent how the gym page could work
better"): the same method, the answer in the conversation, nothing filed.

**Everything at once: a sweep.** Tick **all** on "Run workflow" (or
`gh workflow run rnd.yml -f all=true`) and every focus is researched at the same
time, each in its own job, and one job files all the answers. They are filed
weakest first, so the proposal with the most impact for the most confidence sits
at the top of the issue list. One focus failing leaves the others filed, and
running the failed jobs again files nothing twice. Two foci can land on the same
idea, since neither sees the other's answer: close one as a duplicate. A sweep
is fifteen Claude sessions at once, about four days of scheduled R&D, and it can
leave more than eight proposals waiting, which pauses the schedule until you
have decided on some. The schedule itself never sweeps.

**Built to read the web safely.** An agent that reads untrusted text stays safe
when it cannot also reach private data and act on it (Willison's "lethal
trifecta", Meta's "Rule of Two"). So the Claude step holds nothing worth
stealing: a read-only token, no shell, no file edits, no MCP servers and none of
your claude.ai connectors (so none of your data), and no reads outside the
checkout. It answers in a fixed JSON shape, and a separate job with no AI, the
only one that can write, checks the answer before filing it: every part present,
plain https links, no secrets or personal details (it files nothing if it sees
any), and no @-mentions or references to other repositories that would reach
anyone. A security weakness is never published: the run fails, naming only the
area, and you look at it in a private session.

**Your controls.** Repository variables: `RND_RUNS_PER_DAY` (0 to 4, 4 when unset;
0 stops the schedule) and `RND_OPEN_LIMIT` (8 when unset). "Run workflow" on R&D
in the Actions tab runs it now, on a focus you pick or on all of them at once
(a sweep, above). The weekly `/improve-factory` pass reads the proposals you
declined, so the agent sharpens over time, and `npm run factory:metrics` counts
proposals built and declined.

It runs in GitHub Actions rather than as a routine because it needs several runs
a day, limits only a workflow can set (a read-only token, a separate job that
files), and a home in this repository like the rest of the factory.

## Fitting a Claude Max subscription

Max has usage limits shared across chat, Claude Code, cloud sessions, GitHub
runs and routines, several times Pro's. The factory spends them on judgement,
now more freely than on Pro, and keeps free, deterministic tools for everything
mechanical:

- **The model.** This project uses `opus` throughout: the strongest model for
  planning and building alike. On Pro it was `opusplan` (Opus to plan, Sonnet to
  build); switch back with `/model opusplan` if a month runs close to the limit.
  Claude's GitHub jobs (`@claude`, the review, the error and CI fixes, conflict
  resolution) also run `--model opus`.
- **Context.** `AGENTS.md` is short and always loaded; detail sits in rules that
  load only for matching files, and in skills that load when used. The verifier
  subagent keeps long test output out of the main conversation.
- **Hooks and scripts do the mechanical work**: formatting, checks, the guard,
  the health report. They cost no usage.
- **A review on opening and on every push.** Fix-ups after a review are reviewed
  too, a push by Claude's own CI fix among them: a later push is reviewed from the
  commit the last review covered. Pushes
  close together cancel the earlier run, and drafts wait until they're ready. Every
  review ends in one comment, "Reviewed abc1234: no issues found" or the findings on
  their lines, and a script then fails the **Claude review** check when no comment
  names the head commit, so a review that posts nothing can't look like a pass. The
  instructions are the factory's own (`.claude/commands/review-pr.md`, read from the
  base branch, so a pull request can't rewrite its own review); `/improve-factory`
  can tune them. Ask for another with `@claude review`, run `/review-pr` in a
  session, or label a PR `skip-review`.
- **Room for longer jobs.** The turn caps allow harder fixes: 150 for `@claude` and
  error fixes, 120 for CI fixes, 80 for conflicts.
- **Up to five error fixes a day.** The triage is a script and costs nothing; each
  fix it hands to Claude counts like a session (`ERROR_AUTOFIX_PER_DAY`, 5 when
  unset).
- **Weekly routines.** The refactor and the factory pass stay weekly: each opens a
  pull request for you to merge, so more often means more merging, not more value.
- **R&D, up to four runs a day.** It runs more often because a proposal costs you
  a glance, not a merge. Each run is one Opus session of up to 80 turns that only
  reads and researches, and the AI is skipped while eight proposals wait. If a
  month runs close to the limit, set `RND_RUNS_PER_DAY` to 2, 1 or 0. A sweep by
  hand is one such session for every focus, all at once.
- **Habits.** `/clear` between unrelated tasks; plan big changes first so the
  build is right the first time; run parallel sessions when the tasks are truly
  separate, each in its own worktree.

### API credits

Max includes $100 a month of Claude API credits (Ultra $200), once a Claude
Console organisation is linked in claude.ai, Settings, Billing, API credits. Unused
credits expire each billing cycle. They cover the Messages API, Batches, Managed
Agents and the Agent SDK. They do **not** cover Claude Code, and runs of the Claude
Code GitHub Action count as Claude Code usage, so the factory's CI stays on the plan.

The portal may use the API for work it does on its own, with no chat open: a
server-side call with `ANTHROPIC_API_KEY` from the linked organisation, set in
Vercel for Production only and marked sensitive, never in GitHub or the repo. Give
the portal its own Console workspace with a spend limit. Conversations about the
owner's data go through the Claude connector instead, which runs on the plan.

## Security

- The repository is public: secrets live in `.env.local` (never read by agents:
  the settings deny it) and in GitHub and Vercel settings. GitHub push protection
  blocks a commit that contains a known secret format.
- Production database credentials are environment secrets, usable only on main,
  by the release job and the error triage. The triage's Claude job gets none of
  them, and reads the error text in issues as data.
- Workflows pin every action to a full commit, use read-only tokens by default,
  never put untrusted text into a shell, and are linted by zizmor.
- `@claude` responds only to accounts with write access. Issue text from anyone
  else is treated as data.
- R&D reads the open web, so its Claude step has a read-only token, no shell, no
  MCP servers or claude.ai connectors, and only a script with no AI files what it
  found, after checking it for secrets and personal details ("Research and
  development" above).
- Nobody can push to main, including agents using your credentials in cloud
  sessions; you can still merge a PR whose checks fail, in an emergency.
- `npm audit` for production dependencies is clean; Dependabot and CodeQL watch it.

## One-time setup

Done once by you, since each needs your accounts. About fifteen minutes.

1. **Merge the factory PR.** Its guard check needs the `approved-test-change`
   label (it reformatted existing tests), and that label exists after step 2.
2. **GitHub settings and secrets.** In a terminal, `bash scripts/github-setup.sh secrets`.
   It turns on CodeQL, Dependabot security updates and private vulnerability
   reporting, creates the labels, protects main, and prompts (hidden input) for
   the Supabase access token, the database password and a Claude token from
   `claude setup-token`.
3. **The Claude GitHub App.** Install it on this repository from
   github.com/apps/claude. `@claude`, the review, auto-fix and routines need it.
4. **Vercel.** Project settings, Build and Deployment, Deployment Checks, Add
   checks, GitHub: require "Production database migrated", "Checks" and
   "Integration". The first appears in the list after the first merge that runs
   the release workflow. `vercel.json` already turns off preview builds: previews have
   no database, and CI renders every page instead.
5. **The cloud environment.** At claude.ai/code, keep the Default environment's
   Limited network access: everything the factory needs (npm, nodejs.org, the
   Supabase and Playwright images, Google Fonts) is on the default allowlist. No
   setup script is needed; the SessionStart hook installs Node 24 and the
   dependencies.
6. **The weekly routines.** Run `/schedule` in Claude Code and create two, on this
   repository, each with the GitHub connection and no other connectors:
   - Sunday 20:00, "Weekly refactor": `Run /refactor. Open one pull request, or none if the queue has nothing worth a PR.`
   - Sunday 21:00, "Improve the factory": `Run /improve-factory.`
7. **Locally.** `git config blame.ignoreRevsFile .git-blame-ignore-revs`, so blame
   skips the formatting commit. `fnm` and `nvm` pick up `.nvmrc` (Node 24).
8. **Error triage.** Nothing is required: it uses the release job's secrets and
   creates its labels the first time it files an issue. To change the daily limit
   on fixes, set the repository variable `ERROR_AUTOFIX_PER_DAY`. To try it, run
   "Error triage" from the Actions tab.
9. **R&D.** Nothing is required: it uses the Claude token from step 2 and creates
   its `rnd` label the first time it files. Its first runs say "No page shots"
   until CI on main has captured the pages once, on the next merge. To run it
   less often, set the repository variable `RND_RUNS_PER_DAY`; to try it, run
   "R&D" from the Actions tab.

## Sources

- Anthropic, [Claude Code best practices](https://code.claude.com/docs/en/best-practices.md), [hooks](https://code.claude.com/docs/en/hooks.md), [cloud environments](https://code.claude.com/docs/en/cloud-environments.md), [scheduled tasks](https://code.claude.com/docs/en/routines.md), [GitHub Actions](https://code.claude.com/docs/en/github-actions.md), [managing costs](https://code.claude.com/docs/en/costs.md), and [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).
- Birgitta Böckeler, [Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html) (martinfowler.com, 2026): guides and sensors, keeping quality left, the steering loop.
- OpenAI, [Harness engineering](https://openai.com/index/harness-engineering/) (2026): the repository as the system of record, `AGENTS.md` as a map, architecture enforced by linters, recurring clean-up agents.
- Vercel, [AGENTS.md outperforms skills in our agent evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals), and Next.js [16.2](https://nextjs.org/blog/next-16-2-ai) and [16.3](https://nextjs.org/blog/next-16-3-ai-improvements) AI improvements; [Deployment Checks](https://vercel.com/docs/deployment-checks).
- Zhang et al., [Agentic Context Engineering](https://arxiv.org/abs/2510.04618) (ICLR 2026); Zhang et al., [Darwin Gödel Machine](https://arxiv.org/abs/2505.22954) (ICLR 2026); Robeyns et al., SICA, a self-improving coding agent (2025).
- Gottweis et al., [Towards an AI co-scientist](https://arxiv.org/abs/2502.18864) (2025): generate, critique, rank and refine ideas; Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (2025): start broad, then narrow, and prefer primary sources.
- Simon Willison, [The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) (2025), and Meta, [Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/) (2025): an agent that reads untrusted text must not also hold private data and the means to act on it.
- StrongDM's software factory, as described by [Stanford CodeX](https://law.stanford.edu/2026/02/08/built-by-agents-tested-by-agents-trusted-by-whom/): scenarios kept out of the agents' reach.
- Adam Tornhill, *Your Code as a Crime Scene*: hotspots as size times change frequency.
- Supabase, [CLI v3 migration guide](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3) and [managing environments](https://supabase.com/docs/guides/deployment/managing-environments).
