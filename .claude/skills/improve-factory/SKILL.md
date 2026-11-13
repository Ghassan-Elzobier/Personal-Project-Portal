---
name: improve-factory
description: The factory's weekly self-improvement pass - turns logged friction, failed checks and review comments into at most three small, evidenced improvements to the factory's rules, checks, skills and docs, opened as one pull request. Run by the weekly routine, or when the owner asks to improve the factory.
disable-model-invocation: true
---

# Improve the factory

The factory is the harness around the code: `AGENTS.md`, `.claude/` (rules,
skills, hooks, settings), the lint config, the guard, the tests and CI, and
`docs/`. This pass makes it a little better each week, using what actually went
wrong, the way the research on self-improving agents says works:

- **Small deltas, not rewrites** (Agentic Context Engineering, ICLR 2026).
  Rewriting a playbook wholesale collapses it into vague summaries. Add, edit or
  delete individual lines; never regenerate a file.
- **Repeated problems become checks** (the steering loop in Böckeler's harness
  engineering). The second time a mistake happens, encode it, preferring a
  computational check (lint rule, test, guard, hook) over more prose.
- **Every change is validated** (Darwin Gödel Machine, SICA): an improvement
  must cite the evidence it answers and pass the full suite, and the owner merges.

## 1. Gather evidence (read-only)

- `docs/factory/friction.md`: entries under "Open".
- The last week's pull requests: `gh pr list --state all --search "updated:>=$(date -d '7 days ago' +%F)"`,
  then for each, review comments (`gh api repos/{owner}/{repo}/pulls/<n>/comments`)
  and failed check runs (`gh pr checks <n>`). Fix-up commits after review are signal.
- `npm run factory:metrics` and the trend in `docs/factory/metrics.md`.

## 2. Find what repeats

Group the evidence by cause. A cause qualifies when it appears at least twice,
or once if it reached production or cost the owner time. Rank by cost to the
owner. Ignore one-offs: they are noise until they repeat.

## 3. Choose at most three improvements

For each qualifying cause, pick the cheapest control that would have prevented
it, in this order of preference:

1. A computational sensor: an ESLint rule (with a message that says what to do
   instead), a guard check, a unit or end-to-end test, a hook.
2. A sharper guide: one line in the `.claude/rules/` file for those paths, or a
   step in a skill. Only in `AGENTS.md` if it applies to every task.
3. A fix to the tooling itself: a flaky test, a slow script, a misleading doc.

Never loosen a check, raise a threshold, grow a ratchet or delete a test to make
the factory faster; the guard blocks it and the owner would rightly refuse it.
Keep `AGENTS.md` under about 120 lines: move detail into rules or skills.

## 4. Make the changes and prove them

- One pull request titled "Factory: <the improvements>", labelled `factory`.
- In the body, for each improvement: the evidence (links), the change, and how it
  would have caught the original problem. Where you can, show it: a new lint
  rule fails on the old code, a new test fails before the fix.
- `npm run check` and, if checks changed, `npm run test:e2e`.
- Move the friction entries you addressed to "Done" with the PR number. Leave
  the rest open.

## 5. Record the week

Append one row to `docs/factory/metrics.md` from `npm run factory:metrics`.
If nothing qualified, say so in the routine's output and open no pull request;
an empty week is a good week.
