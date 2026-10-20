---
name: refactor
description: Find and rank refactoring opportunities in a project or path: duplication, oversized modules, coupling, drift, and high-churn code with weak tests. Use when asked what to refactor, where the code is tangled, or for a refactor audit; discovery is read-only and returns an evidence-based shortlist.
---

# Find refactoring opportunities

This is an audit, not an edit session. The deliverable is a ranked shortlist with
evidence; do not modify files while discovering. The skill is model-invoked when
a request matches the description; `/skill:refactor` is the explicit fallback.

A refactor changes structure without changing behavior. If the request changes
behavior, call it a behavior change and report it separately. Read the
repository's own instructions first; they win over this skill.

## 1. Resolve the scope

The text after `/skill:refactor` is the task. It may contain a path (`@src`,
`src`, `packages/api`, or a path inside a sentence), a question, or both.

- Resolve each path from the working directory. A directory is the audit scope;
  a file is the initial target. Audit multiple paths separately and report them
  together.
- No path means the current project. If the project is large, propose a scope
  from the documented layout instead of scanning everything blindly.
- If a path does not exist, say so and ask for a real one. Do not guess. Do not
  leave the working directory unless the user explicitly supplied an outside
  path.
- State the resolved scope and the number of files examined in the report.

## 2. Learn the project's standards

- Read the repository's instruction files, contributor guide, architecture
  notes, shared-helper documentation, and CI configuration.
- Record the languages, layout, test framework, documented check commands, size
  or complexity thresholds, and ignore rules.
- Do not import an external style guide, install a tool, or apply a threshold the
  project never stated. If there is no stated threshold, compare against the rest
  of the scope and say that is the basis.
- Note the available evidence: tests, coverage, type checking, linting, git
  history, and any scanner already installed.

## 3. Inventory the scope

- Map source files, tests, exports, imports, and entry points. Mark public
  surface versus internal modules.
- Measure cheap facts: file and function sizes, nesting depth, parameter counts,
  export counts, fan-in and fan-out, and the distance to the nearest test.
- Read git history for churn (`git log --numstat`) inside the scope. Churn is
  context, not a verdict: a frequently changed, tangled file is a stronger
  candidate than a stable, isolated oddity.
- Skip version-control metadata, dependencies, build output, generated files,
  vendored trees, and secrets unless the user explicitly includes them. Respect
  the project's ignore files.
- For a large scope, delegate a read-only survey to a read-only helper if the
  host provides one. Keep the filtering and ranking in the main session.

## 4. Detect signals

For every signal, point at a file and line and explain why it matters here.

| Signal | What to look for | Evidence to cite |
|---|---|---|
| Duplication | The same body or a near-identical block in several places; copy-paste with tiny edits; a helper that already exists in a shared location | Paths and line ranges of each copy; the shared location it should use |
| Size and responsibility | A module or function past the project's limit, or a relative outlier; unrelated exports; deep nesting; long parameter lists | Measured size or responsibility list; the seams where it could split |
| Coupling | Circular or layer-crossing imports, high fan-in or fan-out, feature envy, repeated type switches | The import edge or repeated branch, with both sides named |
| Cohesion and drift | A grab-bag utility module; a name that no longer matches behavior; dead exports; commented-out code; two implementations of one concept | The mismatch or unused export, with its callers |
| Change pressure | High recent churn combined with complexity or weak tests | Churn count over a stated window plus the complexity or test gap |
| Test friction | Behavior with no direct test; tests that mock the unit heavily or assert internals; duplicated setup that hides a missing seam | The test path and the missing or brittle assertion |
| Boundary erosion | Leaking internal types, unchecked casts, mode-selecting boolean parameters, null-heavy returns | The boundary location and the caller that must know the internals |

## 5. Verify and filter

A signal is not a candidate until it is confirmed.

- Read the callers and tests, not just the definition. Duplication may be
  intentional for a protocol version; a large module may be cohesive; an
  "unused" export may be public API.
- Require one concrete artifact: a path with line numbers, a counted duplicate, a
  measured size, a dependency edge, or a test gap. If you cannot point at it,
  drop it.
- Keep pure refactors separate from behavior changes and bugs. Report a bug as a
  bug; do not smuggle it into the refactor list.
- Prefer candidates with an existing test that catches a regression. If the
  behavior is untested, mark the candidate "tests first".
- Reject weak candidates explicitly. A short "not worth it" list proves the
  audit was selective rather than a tour of everything unfamiliar.

## 6. Rank

Use three tiers:

- **Do next:** safe, contained blast radius, high leverage, small or medium
  effort, and a fast verification command.
- **Worth planning:** high leverage but more risk or effort, a public surface, or
  missing tests.
- **Leave it:** low confidence, little leverage, or not worth the churn.

Within a tier, order by leverage first, then safety, then cost. Do not invent a
numeric score; the reasons must be readable.

## 7. Report

Keep the report scannable. Use this shape:

- **Scope and method:** path, file count, tools used, and what was not examined.
- **Top three to five opportunities**, each with a title, tier, evidence at
  `path:line`, the proposed structural change, expected benefit, risk and blast
  radius, effort (S/M/L), and the narrow plus full verification command.
- **Rejected signals:** one line each with the reason it did not qualify.
- **Next step:** ask which candidate to take. Do not start editing.

## 8. Stop conditions

- No worthwhile opportunities: say so with the evidence that was checked instead
  of inventing work.
- The request is a specific refactor rather than an audit: skip the shortlist,
  but use the handoff below.
- The request changes behavior or asks for a rewrite: treat it as an approved
  design change, not this audit.
- The scope cannot be read (missing path, secrets, binary or generated files, or
  an inaccessible tree): report the limitation.

## After selection: safe handoff

If the user chooses a candidate, execution follows these rules:

- State the behavior contract and run the project's documented check to get a
  baseline. Record pre-existing failures.
- If the behavior is untested, add characterization tests first.
- Enter plan mode when the host provides it and the change spans files, changes a
  public surface, or has an unknown step list. Otherwise track the steps in a
  todo list or a short written sequence.
- Make one structural change per step and verify each step. Never mix in
  formatting, bug fixes, or unrelated cleanup.
- Finish with the full project check and report the diff, results, and remaining
  risk. Do not commit unless the user asks.

The audit is done when the scope is stated, every candidate has `path:line`
evidence and a verification command, the shortlist is capped, rejected signals
are explained, and no files were modified.
