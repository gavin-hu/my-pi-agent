# AGENTS.md quality checklist

Use this before saving the plan and again after writing the file. A draft fails
when any applicable answer is no.

## Accuracy

- [ ] Every command is copied from a manifest, script, Makefile, CI file, or docs
      page that defines it. No command is guessed.
- [ ] Every path and package name exists in the repository as written.
- [ ] Every claimed convention is visible in the code or contributor docs.
- [ ] Unknown facts are omitted or named as unknown. They are never filled with
      plausible-sounding placeholders.

## Specificity

- [ ] The file tells an agent something it could not learn from a quick look.
- [ ] It names the actual test, lint, typecheck, and single-test commands.
- [ ] It names the real architecture boundaries and the traps that matter here.
- [ ] Generic advice that would fit any repository is removed.

## Concision

- [ ] Every section earns its place; empty sections are deleted.
- [ ] Rules are short, imperative, and one job each.
- [ ] Deep material is linked, not copied.
- [ ] The file is the smallest version that still prevents likely mistakes.

## Actionability

- [ ] Each instruction says what to do, where, or in what order.
- [ ] Commands include their working directory when it is not the root.
- [ ] Invariants name the failure they prevent.
- [ ] There is no advice that cannot be followed.

## Stability

- [ ] The file avoids volatile file lists, line numbers, and transient counts.
- [ ] It favours stable paths, package names, and commands.
- [ ] It will still be mostly correct after ordinary refactoring.

## Non-duplication

- [ ] It does not restate the README or contributor guide.
- [ ] It does not duplicate `AGENTS.override.md`, `CLAUDE.md`, or a nested
      `AGENTS.md`; the relationship is stated instead.
- [ ] Two sections do not give the same instruction.

## Existing files

- [ ] Correct existing instructions are preserved.
- [ ] Stale instructions are changed only when the replacement is supported by
      repository evidence.
- [ ] The plan lists exact edits, not a wholesale rewrite.
- [ ] A genuinely accurate file produces a no-op plan instead of churn.

## Empty repository

- [ ] No commands, architecture, or conventions are invented.
- [ ] The file says the repository is newly initialized.
- [ ] Only known facts are recorded.
- [ ] Empty sections are omitted.

## Final read-back

- [ ] The written file matches the approved plan.
- [ ] The file was read back from disk, not recalled from memory.
- [ ] Only `AGENTS.md` changed.
- [ ] The report names the path and any real follow-up.
