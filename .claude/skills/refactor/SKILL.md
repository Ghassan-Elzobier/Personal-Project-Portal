---
name: refactor
description: Improve the code's structure without changing behaviour, proven by unchanged tests and screenshots. Use for refactor issues, the weekly refactor run, or when the owner asks to clean something up. Picks the top item from the refactor queue when no target is given.
argument-hint: "[target, issue number, or nothing for the top of the queue]"
---

# Refactor safely

Target: $ARGUMENTS

A refactor changes structure, never behaviour. The proof is that every existing
test passes unchanged and every screenshot stays pixel-identical. If behaviour
must change, it is not a refactor: use `/ship`.

## 1. Pick the target

- Given an issue: `gh issue view`. Given nothing: open `refactor` issues first
  (`gh issue list --label refactor`), then the top of `npm run health`.
- One coherent improvement per pull request, small enough to review in ten
  minutes. Stop at a natural boundary rather than finishing the whole queue.

## 2. Make sure the behaviour is pinned

- Find the tests and screenshots that cover the code. Thin coverage means adding
  characterisation tests first (unit tests that record what the code does today,
  or an end-to-end check), committed before the refactor, so the proof is honest.

## 3. Refactor in small steps

- Move, rename, extract or delete in steps that each keep `npm run check` green.
  Prefer the editor's precision (exact edits) over regex across files.
- Typical moves here: replace a one-off style with a token or shared component;
  move infrastructure out of a domain (`no-restricted-imports` messages say
  where); turn copied state into derived values; delete what knip reports unused.

## 4. Prove it

- `npm run check`, `npm run test:e2e` (screenshots must match exactly: never
  update them in a refactor), and `npm run test:db` if SQL moved.
- `npm run lint:prune` to shrink `eslint-suppressions.json`, and remove fixed
  entries from `e2e/a11y-baseline.json`. The ratchet only ever goes down.

## 5. Pull request

- Title starts with "Refactor:"; label it `refactor`. In the body: what was
  wrong, what it looks like now, the proof, and the queue counts before and after
  (from `npm run health`).
- Anything you noticed but didn't do goes in a new `refactor` issue, not this PR.
