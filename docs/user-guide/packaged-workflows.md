# Packaged workflows

Four workflows ship as skills. Each is model-invoked — a matching request loads
it — and `/skill:<name>` forces it, with the words after the command as the
request. They share one shape: they read before they write, they stop at a plan
you approve, and they leave the judgement to you.

**Use this chapter when** you want the assistant to follow a known method instead
of improvising one: setting up a project's instruction file, choosing what to do
next, auditing a scope for refactoring work, or keeping the docs true.

## Initializing AGENTS.md with /skill:init

`/skill:init` creates or updates the project's effective instruction file
(`AGENTS.md`, or `AGENTS.override.md` when it shadows `AGENTS.md`) through a short
built-in interview and the same plan review. The skill enters plan mode,
reconnoiters the repository, asks up to four questions, and prepares a proposal.
Nothing is written until you approve the plan.

```text
/skill:init
  └─> plan mode (read-only)
        └─> recon: effective instruction file, sourced evidence, existing instructions
        └─> interview: built-in bank, one call of at most 4 questions, minus resolved facts
              ├─ answered ───────────────> reconcile with evidence
              └─ unavailable/cancelled ──> evidence + assumptions
        └─> draft: new file, exact edits, or an honest no-op
        └─> quality gate
        └─> write_plan ──> exit_plan_mode
                             ├─ not approved ──> refine the same plan
                             └─ approved ──────> write/edit the target
                                                 └─ read back + quality checklist
```

The skill uses a packaged question bank, so the whole workflow is explicit rather
than an improvised prompt. The built-in bank covers purpose, verification commands,
non-obvious rules, isolation, completion, sensitive paths, and dependency or
network limits, with state-specific questions for an existing instruction file, an
empty repository, related instruction files, and a shadowing override. Recon
builds a sourced evidence sheet — commands with their definer, generated and
vendored paths from `.gitignore`, workspace packages, and purpose from the README
or manifest — and the first call uses the bank's deterministic set for the state
minus every field it resolved; a second call is allowed only for a material
ambiguity. If the question tool is inactive, there is no UI, or you cancel, the
skill records the unanswered gaps as assumptions and continues from evidence
instead of stalling.

The target is the instruction file Pi actually reads: a root `AGENTS.override.md`
replaces `AGENTS.md` and is edited in place, or the plan consolidates it into
`AGENTS.md` and removes the override. The plan uses the canonical outline,
including `## Steps` and `## Verification`, so approval seeds the apply actions.

The skill's quality checklist requires every command and path to come from a file
that defines it, keeps the file short and specific, and preserves correct
instructions in an existing instruction file. An accurate file can produce a no-op
plan instead of rewriting it. Both an existing repository and an empty one are
supported; an empty repository gets only known facts, with no invented commands.
`/skill:init` needs plan mode, so it is unavailable when the `plan` extension is
disabled. It ships with the full package; loading only `extensions/plan` makes
`/skill:init` unavailable rather than sending a bare skill name.

## Finding refactoring opportunities

The packaged `refactor` skill audits a project or path for refactoring work before
any code moves. It is model-invoked: a request such as "what should I refactor
here?" can load it automatically, and `/skill:refactor` forces it. Discovery is
read-only and returns a ranked shortlist instead of editing files.

Give it a scope with a path, or let it use the current project:

```text
/skill:refactor @extensions
/skill:refactor @extensions/plan
/skill:refactor @extensions/plan/plans.ts
```

A directory is an audit scope, a file is the starting point, and several paths
can be audited together. The skill reads the project's own instructions and CI
thresholds first, then measures the scope with a bundled script — sizes, fan-in,
churn over a stated window, and test proximity by convention — and carries forward
the files above the 90th percentile rather than claiming to have read the tree. It
says what it could not measure, such as a shallow clone's missing history or a
language the scanner cannot read, instead of reporting that as zero. It then looks
for duplication, oversized modules, coupling, structural drift, high-churn code with
weak tests, test friction, boundary erosion, and one change that has to be edited in
many places. It checks callers and tests before keeping a candidate, so intentional
duplication and public API are not reported as opportunities.

The report names the scope and method, then three to five candidates ranked as
**Do next**, **Worth planning**, or **Leave it**. Each candidate includes
`path:line` evidence, the proposed structural change, expected benefit, risk and
blast radius, effort, and the commands that would verify it. Rejected signals are
listed with their reasons. Nothing is edited during the audit.

After you choose a candidate — the skill asks with the shortlist by name — the
handoff keeps the refactor safe: state the behavior contract, run the project's
check for a baseline, add characterization
tests if the behavior is untested, enter plan mode when the change spans files or
a public surface, make one structural change per step, and run the full check at
the end. The skill is advisory rather than an enforcement layer; it can miss a
request or be ignored, but the plan review and the check command still gate
the work once a refactor starts.

## Choosing what to do next

The packaged `next` skill answers "what now?" from the work already in front of
it, not from the conversation's enthusiasm. It is model-invoked: a request such
as "what should I do next?" or "where do I pick up?" can load it automatically,
and `/skill:next` forces it. It only reads; nothing is edited, committed, or
started by the triage itself.

```text
/skill:next                     # the source the conversation picks
/skill:next @extensions/plan    # the same, narrowed to one path
/skill:next what is left?       # keep the sources that answer the question
/skill:next plan file outline @extensions/plan/   # both: the topic and where to look
```

The source is not a mode you name. A conversation that has already done work — a
todo list, a goal, an approved plan, a subagent or job result, a claimed path, an
edited file — is asked what it left open, and only an empty conversation is
triaged from the project, so one command reads the tree at the start of a session
and the session's own loose ends afterwards. Whatever follows the command still
chooses the topic and the scope: the words say what to ask, a path says where to
look, and the usual form is both, so `plan file outline @extensions/plan/` asks
what to do next about that outline with the plan extension as the only evidence.
The report opens by naming the source and how the prompt was read, so a
misreading is visible instead of silently swapping one source for the other.

A project triage reads the working tree, the commits since the last tag, the
changelog's unreleased section, the roadmap or issue list, and the plans
directory — whichever of those the project has — and quotes the project's own
check command without running it. A conversation read takes that command's last
result, the session's diff, the todo list, the goal, the approved plan and its
ticked steps, and what subagents and jobs returned, then lists what it left open.
Either way the tree is evidence, so a candidate is checked against the code
before it is suggested, and a conversation that ended cleanly returns an empty
list rather than the project's backlog. An imperative — `/skill:next fix the
failing test` — is treated as one item: the skill answers with its evidence and
starting command, and asks before starting. A request already scoped to a
refactor audit or to a document that no longer matches the tree goes to the
`refactor` or `project-docs` skill instead of being answered twice.

The report is a numbered list of suggested next todos in priority order, so the
first item is the one to start. Priority is what it would cost to lose: loose
work first — a dirty tree, an unapproved plan, a check that was never run, an
unmerged branch — then a broken promise, such as a README claim the code no
longer meets, then an unfinished one, such as the remaining steps of an approved
plan. New capability comes last. Each item also carries a label for the ceremony
it needs — **Do next**, **Worth planning**, or **Later** — which says how much
work it takes, not where it sits in the order. The list is capped at three to
five items, each with `path:line` evidence, the command that starts it, and an
effort estimate, plus the candidates that were rejected and why.

An empty list is a valid result: when nothing is worth doing, the skill says so
with what it checked instead of inventing work. It is advisory, so it can miss a
promise or misjudge a priority; the tree it cites and the evidence it quotes are
the parts you can verify. Once you pick an item, the handoff is the same as a
refactor's: plan mode for a multi-file change, a todo list for a small one, and
the project's check as both baseline and finish line.

## Keeping the docs honest

The packaged `project-docs` skill keeps the four documents a reader trusts — the
front door, the roadmap, the contributor path, and the changelog — telling the truth
about the code. It is model-invoked: a request such as "the README still lists a
command we removed" or "add a changelog entry for this" can load it automatically,
and `/skill:project-docs` forces it. It has five modes, the words after the command
pick one, and no words at all means the read-only audit:

```text
/skill:project-docs                 # audit: every document, against the tree and each other
/skill:project-docs changelog       # one bullet for this change, in this commit
/skill:project-docs release 0.19.0  # curate one version's section from the project's rules
/skill:project-docs roadmap         # delete what shipped, renumber, keep the caps
/skill:project-docs readme          # sync the catalog rows, counts, and examples
```

Every mode starts the same way: it finds the project's documents, the version's
single source, the changelog's category names and scope spelling, the roadmap's item
form and caps, the check command, and the guards by name, then states that profile in
one line — so a misread is visible in a sentence instead of in a diff. Nothing it
finds is imposed: the project's own conventions win, and where two sources disagree
it asks rather than averaging them. In this package the answers live in the changelog
preamble, `AGENTS.md`, `ROADMAP.md`, and Development, and the skill names them as its
worked example.

`audit` is read-only, and the default. It reads five faces — the tree against the
docs, the docs against each other, the changelog's commit window, the roadmap's own
ids and caps, and the front door's examples — and every finding names the mode that
fixes it. A change that shipped without a bullet, a count the tree has outgrown, and
a roadmap item the code already does all arrive here, before a release rather than
after it. A bundled `state` script prints the changelog file, the tag, the commits in
the window, the `[Unreleased]` categories with their counts, and the empty or
duplicated headings, so the audit starts from facts rather than a hand-run `git log`.

`changelog` writes one bullet for one user-visible change, under `[Unreleased]`,
scoped by the extension or area it touches, and in the same commit as the change
itself — a changelog that trails the work is a changelog nobody trusts. It does not
decide what has already shipped; only you do.

`release` runs only when you name a version, and the steps it follows are the
project's release document — this package's is
[Development](../development.md#release), with the version bump, the link references,
and the tag-and-`main` push order. Never treat an audit as a release.

`roadmap` re-derives the file from the commits since the last tag rather than from the
last tag itself, deletes what the tree already does with the reason recorded where the
item was, and renumbers the ids and every citation with them. It sets no priority and
no date.

`readme` keeps the front door equal to the tree: the catalog rows, the counts the
pages state, an example that actually runs, and the mirrored translation in step with
it. It does not move a guide's detail up into the front door, or change positioning on
its own.

It is advisory rather than an enforcement layer: it can miss a claim, and it will not
touch a judgement — priority, dates, non-goals, and contribution policy stay yours.
The project's check is the gate, and in this package the documents are held by
`test/docs-parity.test.ts`, `test/extension-load.test.ts`, `test/roadmap.test.ts`, and
`test/release.test.ts`. A request that is really "what should I do next?" belongs to
`next`, and one about structure to `refactor`.

## Related

- [Plan first, then write](./plan-and-verify.md#plan-first-then-write) — the review every one of these workflows ends in.
- [Reference](./reference.md#commands) — the skill commands on one page.
- [Configuration](../configuration.md) — the keys each one reads.

---

[← Previous: Delegate and background](./delegate-and-background.md) · [Guide home](./README.md) · [Next: Keep your work safe →](./keep-work-safe.md)
