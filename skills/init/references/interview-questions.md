# Built-in init questions

The `init` skill selects from this bank. It is a menu, not a checklist: one
`ask_user_question` call with at most four entries is the default, and a second
call is allowed only for a material ambiguity. Never ask for secrets,
credentials, tokens, environment values, or personal data.

## Consolidation rules

The bank merges questions that would otherwise create two copies of the same
answer:

- **Isolation** absorbs the workflow question: worktree, branch, or direct is the
  first decision an agent makes.
- **Done** absorbs testing and documentation expectations: both define when a
  task is complete.
- **Sensitive** absorbs generated, vendored, and secret-bearing paths.
- **External changes** absorbs dependency and network policy.
- **Commits** absorbs branch naming.
- **Scope** and **Related docs** stay separate because they decide where the file
  applies and how it relates to another instruction file.

## Deterministic default sets

Use the first matching row. Fill option labels with evidence before asking.

| Repository state | First four questions |
|---|---|
| Existing project, no `AGENTS.md` | Purpose (only if unclear; otherwise Priorities), Verify, Rules, Isolation |
| Existing project, `AGENTS.md` present | Existing file, Preserve (only if sections are unclear), Priorities (only if stale), Rules |
| Empty or near-empty repository | Stack, Commands, Purpose, Priorities |
| Related instruction files present | Swap Related docs in for Preserve or Rules |
| Git repository with no guidance | Isolation, Verify, Done, External changes |
| No UI, inactive tool, or cancelled interview | No call; record the gaps as assumptions |

## Core questions

| Header | Question | Shape | Selected when |
|---|---|---|---|
| Purpose | What is this project, and who will agents work on it for? | Free-form | README and manifest do not state the purpose and audience, or the repository is empty/near-empty. |
| Verify | Which commands should an agent trust to verify a change? | Multi-select: detected install, build, test, lint, and typecheck commands, plus No reliable command yet; free-form Other for a missing command | Detected commands conflict or are ambiguous, or no command was found. |
| Rules | What should an agent know that is not obvious from the code? | Free-form | No explicit conventions, invariants, style rules, or traps are found in the source, docs, or contributor files. |
| Isolation | How should agents isolate and land work? | Single-select: Worktree per task, then PR; Branch in the current checkout, then PR; Commit directly; Follow repository instructions | The project is a Git repository with no stated isolation or branch rule. |
| Done | What must be true before a task is done? | Multi-select: Tests pass; Lint and typecheck pass; Docs and changelog updated; Diff self-reviewed; Pull request opened | No contributor guide defines done, test level, or documentation expectations. |
| Sensitive | Are any files, directories, or workflows off-limits for agents? | Free-form, including generated, vendored, and secret-bearing paths | Access boundaries are unclear, or generated, vendored, or secret-bearing paths need explicit exclusion. |
| External changes | May an agent add dependencies or use the network? | Single-select: Yes, when needed; Ask first; Offline and no new dependencies | A manifest exists and dependency, package-install, or network rules are unclear. |
| Existing file | How should `/init` handle the current `AGENTS.md`? | Single-select: Review and update in place; Keep it and only append missing guidance; Rewrite it from this interview | `AGENTS.md` already exists. |

## State questions

| Header | Question | Shape | Selected when |
|---|---|---|---|
| Stack | What are you building, and with which language or framework? | Free-form | The repository is empty/near-empty, or no manifest or README states the stack. |
| Commands | What install, build, test, lint, and typecheck commands do you intend to use? | Free-form, with None yet accepted | The repository is empty/near-empty and no real command exists to copy. |
| Related docs | How should `AGENTS.md` relate to existing instruction files? | Single-select: Link to them and add only gaps; Consolidate them into `AGENTS.md`; Leave them alone | `CLAUDE.md`, `AGENTS.override.md`, or a nested `AGENTS.md` exists. |
| Preserve | Which current instructions must stay? | Free-form | `AGENTS.md` exists and its authoritative sections are unclear. |
| Scope | Where should `AGENTS.md` apply? | Single-select: Repository root only; Root plus package-level files; Follow an existing instruction file | The repository is a monorepo, has nested packages, or already has a related instruction file. |

## Optional follow-ups

| Header | Question | Shape | Selected when |
|---|---|---|---|
| Priorities | What should agents optimize for here? | Multi-select: Correctness and safety; Small, reviewable changes; Fast iteration; Test coverage; Match existing style | No `AGENTS.md` yet, or the current priorities are absent or ambiguous. |
| Planning | When should an agent plan before acting? | Single-select: Non-trivial or multi-file work; Every task; Only when asked; Never | No plan-mode or workflow guidance exists. |
| Commits | What commit convention and branch naming should agents follow? | Single-select: Conventional Commits with type/scope; Plain descriptive messages; Repository-defined convention; No preference | No commit or branch guidance exists in docs or CI. |
| Release | What release or versioning process must an agent follow? | Single-select: Maintainer handles releases; Follow documented release steps; No release process; free-form Other | The project is published or versioned and the process is unclear. |
| Performance | Are there performance budgets or hot paths to protect? | Free-form | The project exposes performance-sensitive code or has benchmarks. |
| Environment | What local services or setup steps does an agent need? | Free-form, no secrets | Setup requires services, databases, or environment configuration that is not documented. |
| Finish | Anything else the next agent should know? | Free-form | Always optional, at most once. |

## Selection rules

- Ask at most four questions in one call, ordered by impact: state-specific
  question first, then command verification, then conventions and limits.
- Use the deterministic default set for the state. Do not pick a random subset.
- Never ask for something the recon already answered, and never ask for a secret
  or credential.
- One custom gap question is allowed only when no bank entry covers a material
  fact. It counts toward the four-question cap.
- One follow-up call is allowed only when an answer creates a material ambiguity.
  Cancel it cleanly if the user stops; the first round's answers stay valid.
