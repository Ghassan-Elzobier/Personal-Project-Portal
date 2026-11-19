@AGENTS.md

# Claude Code

- Skills: `/ship` (any change), `/design` (UI), `/refactor` (structure, no behaviour change),
  `/migrate` (database), `/improve-factory` (the weekly self-improvement pass).
- Agents: `verifier`, `debugger`, and `rnd` for ideas, research or a design review
  (read-only; it answers in the session and files nothing).
- Hooks format each file you edit, and the Stop hook runs the fast checks on your
  changes before you can finish (`.claude/hooks/`).
- When compacting, keep: the task, the files changed, the checks run and their results.
