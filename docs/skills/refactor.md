# refactor — find what to refactor, then carry it

`refactor` audits a project or a path for duplication, oversized modules, coupling,
drift, and high-churn code with weak tests, and returns a ranked shortlist with
`path:line` evidence and a verification command per candidate. Discovery is
read-only; once you pick a candidate, it carries a behaviour-preserving refactor
from a stated behaviour contract.

## What you can do

| What you want | What to do |
|---|---|
| Audit the project you are in | `/skill:refactor` |
| Audit one directory or file | `/skill:refactor extensions/plan` |
| Audit several, reported together | `/skill:refactor lib test` |
| Act on a candidate from the shortlist | name it; the audit becomes a handoff |
| Carry one already-agreed refactor | ask for that refactor and skip the shortlist |

## Try it

```text
/skill:refactor extensions/plan
```

The reply states the scope and the file count, then the top three to five
candidates — tier, `path:line` evidence, the structural change, benefit, risk,
effort, and the narrow plus full verification command — then the signals it
rejected, one line each. No file is touched before you pick one.

## Reference

**The inventory script.** `bun skills/refactor/scripts/inventory.ts <path …>
[--churn-days N] [--limit N]`, resolved against the skill's own directory. It prints
the scope, the languages measured, the size distribution, fan-in, churn over a
stated window, test proximity, and the files past the 90th percentile in any of
them: facts, never a verdict. A `no history`, `unresolved`, or `skipped` line is
repeated in the report rather than read as zero. It needs Bun for the script and git
for the churn window.

**What a signal needs.** Duplication, size, coupling, cohesion and drift, change
pressure, shotgun surgery, test friction, boundary erosion, and doc-versus-code
drift, read against the project's own standards. The script measures per file, so
nesting, parameter counts, and function length come from reading the outliers. A
threshold counts only when it is quoted with the file that states it; with none, the
finding rests on a comparison within the scope, and the report says so.

**Tiers and the report.** **Do next** (contained blast radius, fast verification),
**Worth planning** (higher leverage, more risk, a public surface, or missing tests),
and **Leave it** — no numeric score, because the reasons have to be readable. A bug
is reported as a bug, never smuggled into the list, and a candidate with no test is
marked "tests first".

**The handoff.** A stated behaviour contract, a recorded baseline, characterisation
tests first when the behaviour is untested, one structural change per step, and no
mixed cleanup — which is what keeps the promise that behaviour did not change.

## Limits

- The audit modifies nothing; it ends by asking which candidate to take.
- A behaviour change or a rewrite is not a refactor: it is treated as the design
  change it is.
- It stays inside the working directory unless you name a path outside it, and it
  asks for a real path instead of guessing at a missing one.
- Generated, binary, and secret-bearing files are not read; a scope it cannot read is
  reported as a limitation rather than skipped quietly.
- The signals are heuristics: a deliberate duplicate and a cohesive large module are
  kept out only by reading the callers, so a shortlist is reviewed, not obeyed.

## Learn more

- [`next`](./next.md) — the wider triage; it hands a scoped refactor question here.
- [`plan`](../extensions/plan.md) — the read-only mode an audit runs in.
- [`worktree`](../extensions/worktree.md) — where the refactor after the audit lands.
- [`init`](./init.md) — the project's instructions, which set the thresholds a
  finding is measured against.
