# AGENTS.md quality checklist

Use this before drafting and again after writing the file. A draft fails when any
applicable answer is no. The interview and the written file are checked together:
an answered question that never reaches the file is as much a defect as an
invented command.

## Question-bank use

- [ ] The first call used the deterministic default set for the repository state.
- [ ] At most four questions were asked in the call.
- [ ] No question offered more than four options, and none spent one on a free-form
      escape the tool already provides.
- [ ] Options were filled from evidence where the bank names commands, files, or
      instruction documents.
- [ ] No question duplicated a fact the recon already answered.
- [ ] No question asked for a secret, credential, token, environment value, or
      personal data.
- [ ] A second call happened only for a material ambiguity, not to collect extra
      preferences.

## Interview quality

- [ ] Every answer is reflected in the draft, or the plan states why it was not
      adopted.
- [ ] A cancelled or unavailable interview left explicit assumptions instead of
      guessed facts.
- [ ] A conflict between an answer and repository evidence is visible in the
      plan, with the chosen resolution.
- [ ] The plan names which questions were asked and what the user answered.

## Target file

- [ ] The plan names the instruction file Pi reads in the target directory.
- [ ] A root `AGENTS.override.md` is the target, or the plan removes or renames it
      while consolidating its instructions into `AGENTS.md`.
- [ ] The written file is not an `AGENTS.md` that a root override shadows.
- [ ] An override above the project root or in the agent directory is reported,
      not edited.

## Evidence accuracy

- [ ] Every command is paired with the file that defines it in the evidence sheet.
- [ ] Every path and package name exists in the repository as written.
- [ ] Every claimed convention is visible in the code or contributor docs.
- [ ] Generated and vendored exclusions name paths that exist and are backed by
      `.gitignore` or build output.
- [ ] Purpose came from the README lead or manifest description, or was asked.
- [ ] No field marked `resolved` was asked again in the interview.
- [ ] Unknown facts are omitted or named as unknown. They are never filled with
      plausible-sounding placeholders.
- [ ] An answer that contradicts the code is treated as intent, not as evidence
      that the code is wrong.

## Specificity

- [ ] The file tells an agent something it could not learn from a quick look.
- [ ] It names the actual test, lint, typecheck, and single-test commands.
- [ ] It names the real architecture boundaries and the traps that matter here.
- [ ] Isolation, verification, and completion rules say what to do, not just what
      to value.
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
- [ ] Dependency, network, and off-limits rules name the boundary an agent must
      respect.

## Stability

- [ ] The file avoids volatile file lists, line numbers, and transient counts.
- [ ] It favours stable paths, package names, and commands.
- [ ] It will still be mostly correct after ordinary refactoring.

## Non-duplication

- [ ] It does not restate the README or contributor guide.
- [ ] It does not duplicate `AGENTS.override.md`, `CLAUDE.md`, or a nested
      `AGENTS.md`; the relationship is stated instead.
- [ ] Two sections do not give the same instruction.

## Plan and review

- [ ] The plan uses `## Steps` and `## Verification`.
- [ ] Each top-level step is an apply action, not a bullet from the draft.
- [ ] An existing-file change is shown as a before/after diff, not prose edits.

## Existing files

- [ ] Correct existing instructions are preserved.
- [ ] Stale instructions are changed only when the replacement is supported by
      repository evidence or an explicit answer.
- [ ] The plan lists exact edits, not a wholesale rewrite.
- [ ] An override that is consolidated is removed or renamed in the same step, and
      its instructions are preserved.
- [ ] A rewrite records what is being removed and why.
- [ ] A genuinely accurate file produces a no-op plan instead of churn.

## Empty repository

- [ ] No commands, architecture, or conventions are invented.
- [ ] The file says the repository is newly initialized.
- [ ] Only known facts and interview answers are recorded.
- [ ] Empty sections are omitted.
- [ ] Missing commands are named as missing, not replaced with a framework
      default.

## Final read-back

- [ ] The written file matches the approved plan.
- [ ] The project's own check passed against the written file, or the report names the
      failure it returned.
- [ ] The file was read back from disk, not recalled from memory.
- [ ] Only `AGENTS.md` changed.
- [ ] The report names the path, whether the interview was answered or fell back
      to assumptions, and any real follow-up.
