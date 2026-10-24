# Discover the project's documents

A document is a convention before it is a file: which documents exist, what each one
promises, how a version is spelled, and when an entry is written are all things a
project chose. Read what it chose. Do not import a template where the project says
something else, and do not average two sources — when they disagree, ask.

Find these five things, in this order. The first one locates the rest.

## 1. The document set

The documents this skill looks for, in the order it looks, and where a project keeps
them. A project that has only some of them is normal: the skill maintains what exists,
and whether to adopt a missing one is the maintainer's decision rather than an edit.

- **The front door** — `README.md` first, then `README.rst`, `README`, or `docs/README.md`.
  A mirror (`README.zh-CN.md`, `README.ja.md`) is part of the front door, not a
  separate document: it carries the same sections, table rows, and links.
- **The plan of record** — `ROADMAP.md`, then `ROADMAP`, `docs/roadmap.md`, a
  `ROADMAP` section in the front door, or an issue tracker label the project's docs
  name. A project with none is maintained from the changelog and the tree alone; say so.
- **The record of what shipped** — `CHANGELOG.md`, then `CHANGELOG`, `CHANGES.md`,
  `HISTORY.md`, `NEWS.md`, `docs/CHANGELOG.md`, `docs/changelog.md`. The bundled script
  takes the first name in that order. Several changelogs belonging to several packages
  are a scope question, not a choice: ask which package is in scope, and never treat one
  package's file as a copy of another's.
- **The contributor path** — `CONTRIBUTING.md`, then `.github/CONTRIBUTING.md`,
  `docs/contributing.md`, and the instruction file the project's agent reads
  (`AGENTS.md`, `CLAUDE.md`), which usually states the rules the other three obey.

Deep guides (`docs/`, `documentation/`) are where detail belongs. Their existence is
the reason the front door can stay short: it summarizes and links, and the skill must
not move a guide's content up into it, or copy the front door's catalog down.

These rules are written in Markdown's vocabulary because most projects write their docs
in it. Read the format the project actually uses — reStructuredText, AsciiDoc, plain
text — and fix it in that format: a heading anchor, a link reference, and a fenced
example are spelled differently in each, and converting a document is not this skill's
job.

## 2. The version's single source

One file decides the version: `package.json`, `pyproject.toml`, `Cargo.toml`, a
`VERSION` file, or a `version` module. Everything else repeats it — the newest dated
changelog heading, a tag, a badge, a lockfile. Read the source and the repeats
together; a version that disagrees in one place is the most common stale claim a
release leaves behind.

## 3. The changelog's local conventions

- **Who writes the file** — a preamble that says "generated", a `.changeset/` or
  `.changes/` directory, a release workflow step that writes the changelog, or a
  generator named in the manifest or its config: `semantic-release`, `release-please`,
  `changesets`, `git-cliff`, `goreleaser`, `cargo-release`, `standard-version`. Where a
  tool owns the file, the entry is written upstream — in the commit message's
  convention, in a changeset fragment, or in the generator's config — and never by hand.
- **The preamble** — whether it names Keep a Changelog, Semantic Versioning, a
  different convention, and whether unreleased entries are kept in the file at all.
- **The category names and their order** — Keep a Changelog's set is `Added`,
  `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, in that order, and a
  project may use a subset, add its own, or reorder them. Copy the spelling exactly:
  `Fix` is not `Fixed`.
- **The bullet's shape** — read the newest *released* section, not the first one. Note
  the scope prefix (`- \`core\`: …`, `- [core] …`, or none), whether a bullet may run
  several sentences, the wrap column, and whether backticks or bold carry the scope.
- **Whether the entry ships with the change** — `CONTRIBUTING.md`, the instruction
  file, and a pull-request template say it in one line. Silence is not permission to
  defer: ask, because a changelog maintained per release is a different procedure.
- **The release procedure** — a release document outranks everything here:
  `docs/release.md`, `RELEASING.md`, `CONTRIBUTING.md`'s release section, a
  `publish.yml` job, or a `release` script in the manifest. Read it for the link-ref
  update, the tag format, and the push and publish order.

## 4. The roadmap's rules

- **The item form** — how an item is written and whether it carries an id: `**P1 — …**`,
  `- [ ] …`, `R1: …`, a bare heading. Ids are what a citation elsewhere points at.
- **The buckets and their caps** — horizon names (`Now` / `Next` / `Later`, or
  quarters), and any limit the file states on how many items a bucket holds.
- **The ledger, if there is one** — the table tying a promise in the front door to the
  items that keep it; a row is open while any of its items are.
- **What happens to a shipped item** — the stated rule, usually one line: delete it and
  record the reason, or renumber the rest. Never tick it and leave it, unless the file
  says to.
- **The non-goals** — the "deliberately left thin" or "won't do" list, with the reason
  each carries. Reversing one is a decision, not an edit.

## 5. The check and the guards

The project's check command (`bun run check`, `npm test`, `make check`, a CI workflow)
is the finish line for any edit. Find the guards on these documents by name, because a
guard states the rule better than a summary of it: `release.test.ts`,
`changelog.test.ts`, `docs-parity.test.ts`, `roadmap.test.ts`, a link checker, or a CI
step that compares a count in the docs with the tree.

Quote a guard's name and what it holds; do not restate its rule. Run the guard
directly while iterating — a failing guard names the rule you just broke.

## State the profile

Before editing, write one short paragraph: the documents found, the version's source,
the changelog's categories and scope spelling, the roadmap's item form and caps, the
check command, and the guards. It is how the user catches a misread in one line
instead of in a diff. Do not invent a rule the project never stated; ask instead.

## A worked example

When you are in this repository, the answers are already written down:

- `README.md` and `README.zh-CN.md` — the front door and its mirror; `test/docs-parity.test.ts`
  holds the two to the same headings, table rows, and links.
- `CHANGELOG.md` — Keep a Changelog preamble, categories in the standard order,
  `[Unreleased]` kept in the file, scope in backticks followed by a colon.
- `ROADMAP.md` — items as `**P1 — …**`, `Now` and `Next` capped at ten, a promise
  ledger, and the rule that a shipped item is deleted with its reason;
  `test/roadmap.test.ts` pins the ids, links, and caps, and cannot see that an item
  has shipped.
- `CONTRIBUTING.md` and `AGENTS.md` — the entry lands in the same commit as the
  change, and a behavior change also updates the catalog table in both entry READMEs
  and the relevant guide.
- `docs/development.md` — the normative release procedure.
- `test/release.test.ts` — the guard on subsection names, order, emptiness, and the
  version pin against the newest tag.
- `bun run check` — the finish line; `bun test test/roadmap.test.ts` for one guard alone.

The paths are named, not linked: a skill is installed into projects that do not
contain them, so a link would point nowhere from the place it is read.
