---
name: init
description: Create or update the repository's AGENTS.md through a reviewed plan. Use when the user runs /init or asks to initialize project agent instructions.
disable-model-invocation: true
---

# Initialize AGENTS.md

Goal: **create or update `AGENTS.md`** at the current project root. Reviewing an
existing file is part of preparing that update, not a separate outcome.

`/init` starts this workflow in plan mode. If plan mode is not active, call
`enter_plan_mode` and wait for the user to confirm before investigating or
writing. Do not create or edit `AGENTS.md` until `exit_plan_mode` is approved.

## Workflow

```text
/init
  └─> plan mode (read-only)
        └─> inspect the repository
              ├─ no AGENTS.md
              │    ├─ empty or near-empty repo ──> honest minimal file
              │    └─ real project ──────────────> draft from repository evidence
              └─ AGENTS.md exists ───────────────> review it, then draft exact edits
        └─> quality gate
        └─> write_plan ──> exit_plan_mode
                             ├─ not approved ──> refine the same plan
                             └─ approved ──────> write/edit AGENTS.md
                                                 └─ read back + quality checklist
```

## 1. Inspect

- Read the existing `AGENTS.md` first when it exists. It is the starting point,
  not a file to replace.
- Read the evidence that defines this project: manifests, lockfiles, README, docs
  index, source layout, tests, CI, and agent-facing configuration.
- Find the exact commands for install, build, test, lint, typecheck, and a single
  test. Copy them from the files that define them; never invent a command.
- Note the architecture, conventions, invariants, and traps an agent cannot infer
  from a quick look.
- Check related instruction files (`AGENTS.override.md`, `CLAUDE.md`, or nested
  `AGENTS.md` files) and mention the relationship instead of duplicating them.
- Use `read`, `grep`, `find`, and `ls`. For a large repository, delegate a
  read-only survey to the `explorer` or `reviewer` subagent.
- Do not read or copy secrets, credentials, or private environment values.

## 2. Choose the outcome

| Situation | Outcome |
|---|---|
| No `AGENTS.md`, real project | Draft a new file from repository evidence. |
| No `AGENTS.md`, empty or near-empty repo | Ask for the intended purpose or stack with `ask_user_question` when useful; otherwise write only known facts and omit empty sections. Never invent commands. |
| Existing `AGENTS.md` is accurate | Propose no edits. The plan records the no-op with the evidence. |
| Existing `AGENTS.md` is stale or incomplete | Preserve correct instructions and propose exact edits for the rest. Do not replace it wholesale. |
| Related instruction file exists | Plan the intended `AGENTS.md` only; describe how it relates to the override or nested file. |
| Monorepo or subdirectory cwd | Treat the current working directory as the project root and plan whether a package-level file is needed. Do not write to a parent repository. |
| `/init` runs twice | Review the file written by the first run and propose only real changes. |

## 3. Draft the smallest useful file

- Choose the sections this repository actually needs. Typical sections are
  commands, architecture or navigation, conventions, invariants/traps, docs, and
  workflow rules.
- Prefer short rules over prose. One instruction should have one job.
- Keep it universal: no task-specific notes, no generic advice that applies to
  every repository, no restatement of the README.
- Link to deep documentation instead of copying it.
- For an update, list the exact edits and the text they replace.
- For an empty repository, say plainly that it is newly initialized, record only
  what is known, and leave out sections with nothing real to say.

## 4. Pass the quality gate

Read `references/agents-md-quality.md` before drafting and again before saving the
plan. A draft that fails the checklist is revised, not shipped.

For a large or unfamiliar repository, optionally ask the read-only `reviewer`
subagent to critique the draft against the checklist. Use its findings as
evidence, not as a replacement for reading the repository.

## 5. Plan and review

- Save the proposal with `write_plan`. The plan must name `AGENTS.md`, include the
  draft content or exact edits, and include a verification step that reads the
  written file back against the checklist.
- Call `exit_plan_mode` with the returned path.
- If the user refines or rejects the plan, stay in plan mode, rewrite the same
  plan file with `write_plan` (`plan_path`), and present it again.
- No `AGENTS.md` write may happen before approval.

## 6. Apply and verify after approval

- Create a new file with `write`, or update an existing one with `edit`.
- Change only `AGENTS.md`. Do not touch unrelated files.
- Read the result back and rerun the quality checklist against what is actually
  on disk, not what you intended to write.
- Report the path, what the file covers, and any real follow-up. If a fact was
  missing, say so instead of inventing it.

## Boundaries

- One target: `AGENTS.md` at the project root selected in the plan.
- Plan mode is mandatory. If it is unavailable, stop and explain why instead of
  writing directly.
- Reviewing an existing file never means silently accepting it; it means deciding
  what must change and showing that decision in the plan.
