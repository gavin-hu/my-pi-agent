---
name: refactor
description: "Audit a project or path for refactoring opportunities — duplication, oversized modules, coupling, drift, high-churn code with weak tests — and return a ranked shortlist with path:line evidence, or carry one chosen candidate through a behaviour-preserving refactor. Use when asked what to refactor, where the code is tangled, for a refactor audit, or to execute a refactor already agreed; discovery is read-only."
compatibility: "Bun for scripts/inventory.ts; git for the churn window."
---

# Find refactoring opportunities

Goal: a ranked shortlist a reader can act on — evidence at `path:line`, a verification
command per candidate, and the reasoning a reviewer can argue with. This is an audit:
nothing is modified before the user picks a candidate.

A refactor changes structure without changing behavior. If the request changes
behavior, say so and treat it as a behavior change, not as this. The project's own
instructions and thresholds win over anything here.

## Start here

```bash
bun <skill>/scripts/inventory.ts <path ...> [--churn-days N] [--limit N]
```

Resolved against this skill's own directory. It prints the scope, the languages it
measured, the size distribution, fan-in, churn over a stated window, test proximity,
and the files above the 90th percentile in any of those — facts, never a verdict. The
numbers are the evidence; the ranking is yours.

When it reports `no history`, an `unresolved` count, or a `skipped` language, repeat
that in the report rather than reading the gap as zero. See
[`references/signals.md`](./references/signals.md) for what it measures, what it
cannot, and what each signal needs before it counts.

## 1. Resolve the scope

The text after `/skill:refactor` is the task: a path, a question, or both.

- Resolve each path from the working directory. A directory is the audit scope; a file
  is the initial target. Audit several paths separately and report them together.
- No path means the current project. When the project is large, do not scan
  everything: ask which scope to audit, offering two to four concrete directories with
  their file counts.
- A path that does not exist is a question, not a guess. Ask for a real one, and do not
  leave the working directory unless the user named a path outside it.
- State the resolved scope and the number of files examined in the report.

## 2. Learn the project's standards

Read the instruction files, contributor guide, architecture notes, and CI
configuration. Record the languages, layout, test framework, the check command, the
size or complexity thresholds, and the ignore rules.

A threshold counts only when it is quoted with the file that states it. With no stated
threshold, compare against the rest of the scope — and say that the comparison is what
the finding rests on. Do not import an external style guide, install a tool, or apply a
number the project never chose.

## 3. Read, detect, confirm

The outlier list from the script is the reading list and the budget; the report says
what was left outside it. Walk the signals in
[`references/signals.md`](./references/signals.md) — duplication, size, coupling,
cohesion and drift, change pressure, shotgun surgery, test friction, boundary erosion,
doc-versus-code drift — and remember the script measures per file, not per symbol, so
nesting, parameter counts, and function length come from reading.

A signal is not a candidate until it is confirmed. Read the callers and tests, not just
the definition: duplication may be deliberate, a large module may be cohesive, an
"unused" export may be public API. Every kept candidate carries one concrete artifact —
a path with line numbers, a counted duplicate, a measured size, an import edge, or a
named test gap. A bug is reported as a bug, never smuggled into the list. A candidate
without a test is marked "tests first".

## 5. Rank

Three tiers, and no numeric score — the reasons have to be readable.

- **Do next**: contained blast radius, high leverage, small or medium effort, fast
  verification.
- **Worth planning**: high leverage with more risk or effort, a public surface, or
  missing tests.
- **Leave it**: low confidence, little leverage, or not worth the churn.

Within a tier, order by leverage, then safety, then cost.

## 6. Report

- **Scope and method**: path, file count, what was measured, and what was not examined.
- **Top three to five**: title, tier, evidence at `path:line`, the structural change,
  expected benefit, risk and blast radius, effort (S/M/L), and the narrow plus full
  verification command.
- **Rejected signals**: one line each, with the reason it did not qualify.
- **Next step**: ask which candidate to take, offering the shortlist by name.

## 7. From audit to execution

When the user picks one, read [`references/handoff.md`](./references/handoff.md)
before the first edit: a stated behaviour contract, a recorded baseline,
characterisation tests first when the behaviour is untested, one structural change per
step, and no mixed cleanup are what keep the promise.

## Quality gate

- The scope, the file count, and what was not examined are stated.
- Every candidate has `path:line` evidence, a verification command, a tier, and an
  effort; none carries a numeric score.
- The rejected list is not empty, and it explains each rejection.
- No file was modified, and no bug or behaviour change is in the refactor list.

## Stop conditions

- Nothing worth doing: say so with what was checked instead of inventing work.
- The request is one specific refactor, not an audit: skip the shortlist and go to
  handoff.
- The request is a rewrite or a behaviour change: treat it as the design change it is.
- The scope cannot be read — missing path, secrets, generated or binary files, an
  inaccessible tree: report the limitation and stop.
