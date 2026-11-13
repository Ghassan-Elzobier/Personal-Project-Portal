# The software factory

How changes get made in this repository: you say what you want, an agent builds
it inside a harness of rules and checks, and you review a pull request that has
already proved itself. The harness also keeps the design cohesive, works the
code's structural debt down every week, and improves itself from what goes wrong.

It is built for one owner on a Claude Pro subscription, GitHub, Vercel and
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

You review and merge. Merging deploys: the release workflow migrates the
database, and Vercel waits for it before the new version goes live.

Skills you can call by name: `/ship` (any change), `/design` (UI), `/refactor`
(structure only), `/migrate` (database), `/improve-factory` (the weekly pass).
You rarely need to: `AGENTS.md` carries the essentials into every session, which
evaluations show works better than relying on an agent to pick a skill.

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
| Every PR, once | Claude review, in a fresh session that did not write the code | Logic and design problems the checks can't see |
| Merge | Release: migrate production; Vercel Deployment Checks hold the deploy until it passes | Code going live before its database |
| Weekly | Dependabot, CodeQL, secret scanning with push protection | Vulnerable dependencies, leaked keys |

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

## Fitting a Claude Pro subscription

Pro has usage limits shared across chat, Claude Code, cloud sessions, GitHub
runs and routines. The factory spends them where judgement is needed and uses
free, deterministic tools for everything else:

- **The model.** This project uses `opusplan`: Opus while planning, Sonnet while
  building, the hybrid Anthropic documents for this trade-off. For one session
  that needs Opus throughout, run `/model opus`.
- **Context.** `AGENTS.md` is short and always loaded; detail sits in rules that
  load only for matching files, and in skills that load when used. The verifier
  subagent keeps long test output out of the main conversation.
- **Hooks and scripts do the mechanical work**: formatting, checks, the guard,
  the health report. They cost no usage.
- **One AI review per PR**, on opening, not on every push. Ask for another with
  `@claude review`. Label a PR `skip-review` to skip it.
- **Two weekly routines**, not daily ones. Each run counts like a session.
- **Habits.** `/clear` between unrelated tasks; plan big changes first so the
  build is right the first time; run parallel cloud sessions only when the
  tasks are truly separate, since each draws on the same limits.

## Security

- The repository is public: secrets live in `.env.local` (never read by agents:
  the settings deny it) and in GitHub and Vercel settings. GitHub push protection
  blocks a commit that contains a known secret format.
- Production database credentials are environment secrets, usable only by the
  release job on main.
- Workflows pin every action to a full commit, use read-only tokens by default,
  never put untrusted text into a shell, and are linted by zizmor.
- `@claude` responds only to accounts with write access. Issue text from anyone
  else is treated as data.
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
   checks, GitHub: require "Migrate production database", "Checks" and
   "Integration". `vercel.json` already turns off preview builds: previews have
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

## Sources

- Anthropic, [Claude Code best practices](https://code.claude.com/docs/en/best-practices.md), [hooks](https://code.claude.com/docs/en/hooks.md), [cloud environments](https://code.claude.com/docs/en/cloud-environments.md), [scheduled tasks](https://code.claude.com/docs/en/routines.md), [GitHub Actions](https://code.claude.com/docs/en/github-actions.md), [managing costs](https://code.claude.com/docs/en/costs.md), and [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).
- Birgitta Böckeler, [Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html) (martinfowler.com, 2026): guides and sensors, keeping quality left, the steering loop.
- OpenAI, [Harness engineering](https://openai.com/index/harness-engineering/) (2026): the repository as the system of record, `AGENTS.md` as a map, architecture enforced by linters, recurring clean-up agents.
- Vercel, [AGENTS.md outperforms skills in our agent evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals), and Next.js [16.2](https://nextjs.org/blog/next-16-2-ai) and [16.3](https://nextjs.org/blog/next-16-3-ai-improvements) AI improvements; [Deployment Checks](https://vercel.com/docs/deployment-checks).
- Zhang et al., [Agentic Context Engineering](https://arxiv.org/abs/2510.04618) (ICLR 2026); Zhang et al., [Darwin Gödel Machine](https://arxiv.org/abs/2505.22954) (ICLR 2026); Robeyns et al., SICA, a self-improving coding agent (2025).
- StrongDM's software factory, as described by [Stanford CodeX](https://law.stanford.edu/2026/02/08/built-by-agents-tested-by-agents-trusted-by-whom/): scenarios kept out of the agents' reach.
- Adam Tornhill, *Your Code as a Crime Scene*: hotspots as size times change frequency.
- Supabase, [CLI v3 migration guide](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3) and [managing environments](https://supabase.com/docs/guides/deployment/managing-environments).
