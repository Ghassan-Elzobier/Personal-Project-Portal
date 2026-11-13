@AGENTS.md

# Claude Code

- Skills: `/ship` (any change), `/design` (UI), `/refactor` (structure, no behaviour change),
  `/migrate` (database), `/improve-factory` (the weekly self-improvement pass).
- Hooks format each file you edit, and the Stop hook runs the fast checks on your
  changes before you can finish (`.claude/hooks/`).
- When compacting, keep: the task, the files changed, the checks run and their results.
