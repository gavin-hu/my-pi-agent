# init — write the project's instructions

`init` creates or refreshes the instruction file Pi reads at the project root —
`AGENTS.md`, or `AGENTS.override.md` when one shadows it — from the repository's
own evidence plus a short interview. It writes nothing until you approve a plan,
and it is the one packaged skill the model cannot start by itself: `/skill:init`
is the way in.

## What you can do

| What you want | What to do |
|---|---|
| Give a repository its first `AGENTS.md` | `/skill:init` in that repository |
| Refresh instructions that have gone stale | run it, then approve the edits it proposes |
| Check a file you wrote by hand | run it and take the no-op, or the diff it shows |
| Consolidate an override and its file | answer the target question, approve the consolidation |
| Start an empty repository honestly | run it; it records what is absent instead of guessing |

## Try it

```text
/skill:init
```

It enters plan mode, reads the manifests, docs, tests, and CI, and asks at most four
questions that the evidence cannot answer. The plan carries the draft file, or a
before/after diff, with the questions and how each answer was used; approving it
writes the file, and declining it writes nothing. The walkthrough is
[Plan a change](../tutorials/first-plan.md).

## Reference

**Plan mode is mandatory.** The skill enters plan mode if it is not already active
and stops if you decline, rather than writing directly. Its frontmatter carries
`disable-model-invocation: true`, so the model never starts it on its own: a request
that "should set up AGENTS.md" gets an answer, not an interview.

**Recon.** It resolves the effective instruction file first: a root
`AGENTS.override.md` replaces `AGENTS.md` and `CLAUDE.md` in that directory, so the
override is the target and a new `AGENTS.md` beside it would be dead text. It reads
the other instruction files, the manifest and lockfile, the README, the source
layout, tests, CI, and formatter config, and builds a sourced evidence sheet,
marking each field `resolved` or `unknown`. Commands, paths, and package names come
from the repository; purpose, priorities, and workflow come from you.

**The interview.** One `question` call with at most four questions from the built-in
bank, dropping every question the evidence sheet already answers, with option labels
filled from what was detected. A conflict between an answer and the repository is
kept visible in the plan rather than resolved quietly; a cancelled interview leaves
each gap under assumptions.

**The plan.** `## Goal`, `## Context` (the evidence sheet and the questions),
`## Approach` (the full draft or a fenced before/after diff), `## Steps`,
`## Risks`, and `## Verification` — the project's own check command when it declares
one.

**Apply and verify.** It writes only the file the approved plan names, reads it back
from disk, runs the quality checklist against what is there, and runs the
verification step. A check that fails for a reason the instruction file cannot
cause is reported as unrelated rather than blamed on the draft.

## Limits

- No write happens before approval, and plan mode cannot be skipped.
- It never edits an override above the project root or in the agent directory, and
  never leaves a written `AGENTS.md` shadowed by a root override.
- It does not invent a command from a language's usual tooling: a command with no
  source in the evidence sheet is asked about or left out.
- It reads no secrets, and stops reading a file that looks like a secret store.
- The quality checklist is a judgement, not a proof; a written file is still a file
  you review.

## Learn more

- [`interview-questions.md`](https://github.com/gavin-hu/my-pi-agent/blob/main/skills/init/references/interview-questions.md)
  — the question bank the interview defaults to.
- [`agents-md-quality.md`](https://github.com/gavin-hu/my-pi-agent/blob/main/skills/init/references/agents-md-quality.md)
  — the checklist the draft is held to.
- [`plan`](../extensions/plan.md) — the read-only mode and the plan file behind it.
- [`question`](../extensions/question.md) — the one call the interview makes.
- [`next`](./next.md) — what to do once the instructions are in place.
