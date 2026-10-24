# Signals, and what confirms one

Each row is a reason to look, never a finding. A signal becomes a candidate only when
the evidence column has something in it — a path with line numbers, a counted
duplicate, a measured size, an import edge, or a named test gap. If you cannot point
at it, drop it and write why in the rejected list.

## The table

| Signal | What to look for | Evidence that confirms it |
|---|---|---|
| Duplication | The same body or a near-identical block in several places; copy-paste with small edits; a helper that already exists in a shared location | Paths and line ranges of each copy, and the shared location it should use |
| Size and responsibility | A module or function past the project's stated limit, or a relative outlier; unrelated exports; deep nesting; long parameter lists | The measured size or the responsibility list, and the seams where it could split |
| Coupling | Circular or layer-crossing imports, high fan-in or fan-out, feature envy, repeated type switches | The import edge or the repeated branch, with both sides named |
| Cohesion and drift | A grab-bag utility module; a name that no longer matches behavior; dead exports; commented-out code; two implementations of one concept | The mismatch or unused export, with its callers |
| Change pressure | High recent churn combined with complexity or weak tests | The churn count over a stated window, plus the complexity or the test gap |
| Shotgun surgery | One concept edited in several files every time it changes — a new field added in five places, a new enum member handled in four | Two or more recent commits touching the same set of files for one change, named by commit |
| Test friction | Behavior with no direct test; tests that mock the unit heavily or assert internals; duplicated setup that hides a missing seam | The test path, and the missing or brittle assertion |
| Boundary erosion | Leaking internal types, unchecked casts, mode-selecting boolean parameters, null-heavy returns | The boundary location and the caller that must know the internals |
| Doc-versus-code drift | A README, guide, or instruction file that promises something the code no longer does | The doc line and the code line that disagree; the change is a promise, not a preference |

## What the inventory script measures, and what it does not

`scripts/inventory.ts` prints, for the scope: file and code-line counts, the size
distribution and its p90, exports, fan-in from resolvable relative imports, churn over
a stated window, test proximity by convention, and the files above p90 in any of those
columns. That is the cheap half.

It does **not** measure anything per symbol: nesting depth, parameter counts, function
length, or complexity are not in the report. Read the outlier files for those, and say
in the report which ones you read.

It reads imports and exports for TypeScript, JavaScript, Python, Go, and Rust. Any
other language is counted in the `skipped` column rather than guessed at — so in a
Ruby, PHP, Java, Kotlin, Swift, C, or C# tree, fan-in and export counts are not
evidence and belong in "not examined" unless you measured them by hand.

Two more honest limits, both worth repeating in the report when they apply:

- **A shallow clone has no churn history.** The script says `no history` rather than
  zero, because zero and unknown rank a file very differently.
- **An unresolved specifier is not a missing import.** It means the audit could not
  resolve it — a path alias, a generated module, a language the scanner does not read.
  Name the count, do not treat it as an orphan.

## Confirm before keeping

Read the callers and the tests, not just the definition. Duplication may be deliberate
for a protocol version; a large module may be cohesive; an "unused" export may be
public API; a hot file may be hot because it is the only place that already works.

Keep pure refactors separate from behavior changes and bugs. Report a bug as a bug.
Prefer a candidate with a test that would catch a regression; when the behavior is
untested, mark the candidate "tests first" instead of dropping it.
