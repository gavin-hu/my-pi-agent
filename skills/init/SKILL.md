---
name: init
description: "Initialize or refresh AGENTS.md through a built-in interactive interview and a reviewed plan. Use when the user runs /init or asks to set up project agent instructions."
disable-model-invocation: true
---

# Initialize AGENTS.md

Goal: create or update **`AGENTS.md` at the project root** by combining repository
evidence with a short, built-in interview. The interview captures intent the code
cannot show; the repository supplies every command, path, and convention that can
be verified. Plan mode is the review gate: no write happens before approval.

`/init` enters plan mode and sends this skill. If plan mode is not active, call
`enter_plan_mode` and wait for confirmation. Keep the interview and the plan
review in that order; do not write the file early to save a step.

## Workflow

```text
/init
  └─> plan mode (read-only)
        └─> recon: manifests, docs, CI, tests, existing instructions
        └─> interview: one built-in question call (at most 4)
              ├─ answers ───────────────> reconcile with evidence
              └─ unavailable/cancelled ─> evidence + recorded assumptions
        └─> draft: new file, exact edits, or an honest no-op
        └─> quality gate
        └─> write_plan ──> exit_plan_mode
                             ├─ not approved ──> refine the same plan
                             └─ approved ──────> write/edit AGENTS.md
                                                 └─ read back + quality gate
```

Read [`references/interview-questions.md`](./references/interview-questions.md)
before the interview. Read
[`references/agents-md-quality.md`](./references/agents-md-quality.md) before
drafting and again before writing the plan.

## Repository states

| State | Interview | Outcome |
|---|---|---|
| Existing project, no `AGENTS.md` | Purpose (only if unclear; otherwise Priorities), Verify, Rules, Isolation | New smallest-useful file. |
| Existing `AGENTS.md` | Existing file, Preserve (only if sections are unclear), Priorities (only if stale), Rules | Exact edits that preserve correct instructions, or a no-op. |
| Empty or near-empty repository | Stack, Commands, Purpose, Priorities | Honest minimal file from the answers and known facts only. |
| Related instruction files exist | Swap Related docs in for Preserve or Rules | Describe the relationship; do not duplicate the other file. |
| Git repository with no guidance | Isolation, Verify, Done, External changes | Prefer this set over a generic workflow question. |
| No UI, inactive tool, or cancelled interview | Skip the call; record the gaps as assumptions | Evidence-based draft; the plan review remains the place to correct it. |

The full bank, selectable alternatives, and option wording live in
`references/interview-questions.md`. The table above is the default, not a menu to
exhaust.

## 1. Recon

- Read existing instruction files first: `AGENTS.md`, `AGENTS.override.md`,
  `CLAUDE.md`, and nested `AGENTS.md` files. Note how they relate; do not silently
  absorb or replace one.
- Read the files that define the project: manifests, lockfiles, README, docs
  index, source layout, tests, CI, formatter and linter configuration.
- Build a short evidence sheet: stack, layout, install/test/lint/typecheck
  commands, validation gates, release path, and existing rules.
- List the gaps the interview must fill. Stop the first pass once the shape is
  clear; do not investigate the whole repository before asking.
- In an empty or near-empty repository, record that evidence is absent. Never
  invent a command from a language's usual tooling.
- Check that any command you plan to record is copied from a file that defines it.
- Use `read`, `grep`, `find`, and `ls`. For a large repository, delegate a
  read-only survey to the `explorer` or `reviewer` subagent.
- Do not read or copy secrets, credentials, tokens, or private environment
  values. If a file looks like a secret store, stop reading it.

## 2. Interview

Use `ask_user_question` once with at most four questions from the built-in bank.
Choose the deterministic default set for the repository state.

- One call is the default. Make a second call only when an answer leaves a
  material ambiguity that changes what the file says; do not ask a second round
  merely to collect preferences.
- Fill option labels with evidence: the detected test command, the actual package
  manager, the real instruction file names. Keep a free-form escape on every
  question whose answer cannot be enumerated.
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

Then choose the outcome:

- **No `AGENTS.md`** — draft the smallest useful file. Use the sections this
  repository needs; omit empty ones.
- **Existing `AGENTS.md`** — preserve correct instructions and propose exact
  edits for the rest. If the user chose to rewrite, the plan must still list what
  is being removed.
- **Accurate `AGENTS.md`** — propose no edits and explain the no-op with evidence.
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

- Save the proposal with `write_plan`. The plan must include:
  - the recon summary and the evidence that supports the draft;
  - the questions asked, the answers, and how each answer was used;
  - the full draft for a new file, or the exact edits for an existing one;
  - assumptions, conflicts, and unanswered gaps from a cancelled or unavailable
    interview;
  - a verification step that reads the written file back against the checklist.
- Call `exit_plan_mode` with the returned path.
- If the user refines or rejects the plan, stay in plan mode, rewrite the same
  plan file with `write_plan` (`plan_path`), and present it again.
- No `AGENTS.md` write may happen before approval.

## 6. Apply and verify

- Create a new file with `write`, or update an existing one with `edit`.
- Change only `AGENTS.md`. Do not touch unrelated files.
- Read the result back from disk and rerun the quality checklist against what is
  actually there, not what you intended to write.
- Report the path, what the file covers, whether the interview was answered or
  fell back to assumptions, and any real follow-up. Name a missing fact instead of
  inventing it.

## Boundaries

- One target: `AGENTS.md` at the project root selected in the plan.
- Plan mode is mandatory. If it is unavailable, stop and explain why instead of
  writing directly.
- The built-in bank is the default; one custom gap question is allowed only when
  no entry covers a material fact, and it counts toward the four-question cap.
- Reviewing an existing file never means silently accepting it, and rewriting one
  never means discarding its correct instructions without saying so.
