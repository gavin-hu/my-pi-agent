---
name: init
description: "Initialize or refresh a project's agent instructions (AGENTS.md, or AGENTS.override.md when it shadows AGENTS.md) through a built-in interactive interview and a reviewed plan. Run /skill:init to start it."
disable-model-invocation: true
---

# Initialize agent instructions

Goal: create or update the instruction file Pi reads at the **project root** —
`AGENTS.md`, or `AGENTS.override.md` when one shadows it — by combining repository
evidence with a short, built-in interview. The interview captures intent the code
cannot show; the repository supplies every command, path, and convention that can
be verified. Plan mode is the review gate: no write happens before approval.

`/skill:init` loads this skill. If plan mode is not active, call
`enter_plan_mode` and wait for confirmation. Keep the interview and the plan
review in that order; do not write the file early to save a step. A declined plan
mode ends the skill: stop and explain, rather than writing directly.

## Workflow

```text
/skill:init
  └─> plan mode (read-only)
        └─> recon: effective instruction file, sourced evidence, existing instructions
        └─> interview: one built-in question call (at most 4), minus resolved facts
              ├─ answers ───────────────> reconcile with evidence
              └─ unavailable/cancelled ─> evidence + recorded assumptions
        └─> draft: new file, exact edits, or an honest no-op
        └─> quality gate
        └─> plan outline with ## Steps and ## Verification
        └─> write_plan ──> exit_plan_mode
                             ├─ not approved ──> refine the same plan
                             └─ approved ──────> write/edit the target
                                                 └─ read back + quality gate
```

Read [`references/interview-questions.md`](./references/interview-questions.md)
before the interview. Read
[`references/agents-md-quality.md`](./references/agents-md-quality.md) before
drafting and again before writing the plan.

## Default question sets

The bank's deterministic default sets, in
[`references/interview-questions.md`](./references/interview-questions.md), decide
the first call for each repository state. They are the only copy; do not restate
them here. Drop a question the evidence sheet already answers.

## 1. Recon

- Resolve the instruction file Pi reads in this directory first. A root
  `AGENTS.override.md` replaces `AGENTS.md` and `CLAUDE.md` in the same directory —
  it still applies below — so it is the target; a new `AGENTS.md` beside it would
  be dead text. Report an override above the project root or in the agent
  directory, but never edit outside the project.
- Read the remaining instruction files (`CLAUDE.md`, nested `AGENTS.md` and
  overrides) and note how they relate; do not silently absorb or replace one.
- Read the files that define the project: manifests, lockfiles, README, docs
  index, source layout, tests, CI, formatter and linter configuration.
- Build a sourced evidence sheet: stack and package manager from the manifest and
  lockfile; every install/test/lint/typecheck command with the file that defines
  it; generated, vendored, and build-output paths from `.gitignore` and the tree;
  workspace packages and boundaries; purpose and audience from the README lead or
  manifest description; validation gates, release path, and existing rules. Mark
  each field `resolved` or `unknown`.
- The unknown fields are the interview gaps. Stop the first pass once the shape is
  clear; do not investigate the whole repository before asking.
- In an empty or near-empty repository, record that evidence is absent. Never
  invent a command from a language's usual tooling.
- Use `read`, `grep`, `find`, and `ls`. For a large repository, delegate a
  read-only survey to the `explorer` or `reviewer` subagent.
- Do not read or copy secrets, credentials, tokens, or private environment
  values. If a file looks like a secret store, stop reading it.

## 2. Interview

Use `ask_user_question` once with at most four questions from the built-in bank.
Choose the bank's deterministic default set for the repository state, then drop
every question the evidence sheet already answers: `Purpose` only when README and
manifest are silent, `Verify` only when detected commands are missing or conflict,
`Sensitive` only when generated-path evidence leaves a boundary unclear. Ask the
bank's `Target` question when a root override exists.

- One call is the default. Make a second call only when an answer leaves a
  material ambiguity that changes what the file says; do not ask a second round
  merely to collect preferences.
- Fill option labels with evidence: the detected test command, the actual package
  manager, the real instruction file names. Four options at most, and never one of
  them for a free-form escape: the tool always adds Other, so an "Other" or "None of
  these" label spends a real answer's slot.
- Ask only what the evidence cannot answer. Do not ask for the stack when a
  manifest states it, or for a command already documented in CI.
- Never ask for secrets, credentials, tokens, environment values, or personal
  data.
- If the answers contradict the repository, keep the conflict visible in the plan
  instead of silently choosing a side.
- If the user cancels or the tool is unavailable, continue from evidence and
  record each unanswered gap under assumptions in the plan. In an empty
  repository this means an explicit skeleton that says it is newly initialized,
  with no guessed commands.
- A follow-up question that is cancelled keeps the first round's answers.

## 3. Reconcile and draft

Treat answers and evidence as different kinds of fact:

- Commands, paths, package names, and existing behavior come from the repository.
- Purpose, priorities, scope, workflow, and preferences come from the user.
- If they conflict, record the conflict, what the draft uses, and the alternative
  in the plan. Do not quietly rewrite the user's intent or invent a command to
  match it.
- A command, path, or package with no source in the evidence sheet stays out or is
  asked; it is never inferred from convention.

The target is the effective file from recon. If a root `AGENTS.override.md`
exists, edit it. Never write an `AGENTS.md` that the override shadows; if the user
chooses to consolidate into `AGENTS.md`, the plan removes or renames the override
in the same step and preserves its instructions.

Then choose the outcome:

- **No instruction file** — draft the smallest useful file. Use the sections this
  repository needs; omit empty ones.
- **Existing instruction file** — preserve correct instructions and propose exact
  edits for the rest, shown as a fenced before/after diff. If the user chose to
  rewrite, the plan must still list what is being removed.
- **Accurate instruction file** — propose no edits and explain the no-op with
  evidence.
- **Empty or near-empty repository** — say plainly that it is newly initialized,
  record the interview facts, and omit commands and architecture that do not
  exist yet.
- **Related instruction files** — state the relationship and link them instead of
  copying their content.

Prefer short rules over prose. One instruction should have one job. Link deep
documentation rather than restating it.

## 4. Pass the quality gate

Read `references/agents-md-quality.md` before drafting and again before saving the
plan. Revise a draft that fails the checklist rather than shipping it.

For a large or unfamiliar repository, optionally ask the read-only `reviewer`
subagent to critique the draft against the checklist. Use its findings as
evidence, not as a replacement for reading the repository.

## 5. Plan and review

- Save the proposal with `write_plan` in the documented outline. The plan must
  include:
  - `## Goal` — the outcome for the instruction file;
  - `## Context` — the sourced evidence sheet, the effective-file finding, and the
    questions asked with how each answer was used;
  - `## Approach` — the full draft for a new file, or a fenced before/after diff
    for edits;
  - `## Steps` — one top-level bullet per apply action: write or edit the target,
    read it back, run the check. Without this heading approval seeds the
    shallowest list anywhere, which is the draft rather than the actions;
  - `## Risks` — assumptions, conflicts, and gaps from a cancelled or unavailable
    interview;
  - `## Verification` — the project's own check when it declares one (`run_check`,
    or the narrower docs or structure test that guards the instruction file), then
    reading the written file back against the checklist.
- Call `exit_plan_mode` with the returned path.
- If the user refines or rejects the plan, stay in plan mode, rewrite the same
  plan file with `write_plan` (`plan_path`), and present it again.
- No write to the target may happen before approval.

## 6. Apply and verify

- Create a new file with `write`, or update the target with `edit`.
- Change only the instruction files the approved plan names: the target, and an
  override the plan removes or renames while consolidating. Do not touch unrelated
  files.
- Read the result back from disk and rerun the quality checklist against what is
  actually there, not what you intended to write.
- Run the plan's verification step. A check that fails on the written file is the
  report's follow-up, not a success; a check that fails for something the
  instruction file cannot cause is named as an unrelated failure rather than
  blamed on the draft.
- Report the path, what the file covers, whether the interview was answered or
  fell back to assumptions, and any real follow-up. Name a missing fact instead of
  inventing it.

## Boundaries

- One target for the instructions: the instruction file Pi reads at the project
  root — `AGENTS.override.md` when one exists, otherwise `AGENTS.md`, as selected
  in the plan.
- A consolidation edits the file it absorbs only when the approved plan names it;
  otherwise the other file is left alone.
- Never leave a written `AGENTS.md` shadowed by a root override, and never edit an
  override outside the project root.
- Plan mode is mandatory. If it is unavailable, stop and explain why instead of
  writing directly.
- The built-in bank is the default; one custom gap question is allowed only when
  no entry covers a material fact, and it counts toward the four-question cap.
- Reviewing an existing file never means silently accepting it, and rewriting one
  never means discarding its correct instructions without saying so.
