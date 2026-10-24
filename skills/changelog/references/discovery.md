# Discover the project's changelog rules

A changelog is a convention before it is a file: the category names, their order,
the bullet's shape, and when an entry is written are all things a project chose.
Read what it chose. Do not import Keep a Changelog's defaults where the project says
something else, and do not average two sources — when they disagree, ask.

Find these seven things, in this order. The first one locates the rest.

## 1. The changelog file

`CHANGELOG.md`, then `CHANGELOG`, `CHANGES.md`, `HISTORY.md`, `NEWS.md`,
`docs/CHANGELOG.md`, `docs/changelog.md`. If several exist, the one the project's
own docs link to wins; failing that, the largest. A repository with none has no
changelog to maintain — report that and stop rather than creating a convention:
whether to adopt one is the maintainer's decision.

## 2. The preamble

The first paragraphs of the file say whether it follows Keep a Changelog and
Semantic Versioning, links to them, and often whether unreleased entries are kept in
the file at all. A preamble that names a different convention is the rule that
applies, not this skill's defaults.

## 3. The category names and their order

Keep a Changelog's set is `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
`Security`, in that order, and a project may use a subset, add its own, or reorder
them. Copy the spelling exactly — `Fix` is not `Fixed`, and `### Notes` is a real
category if the file says so. Order is load-bearing: a new heading goes where the
file already puts that category.

## 4. The bullet's shape

Look at the newest released section, not at the file's first one; the shape changes
over time and the newest is the live convention. Note the prefix (`- \`core\`: …`,
`- [core] …`, or none), whether a bullet may run several sentences, the wrap column,
and whether backticks or bold carry the scope.

## 5. Whether the entry ships with the change

`CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, `.github/PULL_REQUEST_TEMPLATE.md`, and
the guide's contribution section say it, usually as one line — "add a changelog
entry in the same commit". Silence is not permission to defer: ask, because a
changelog maintained per release instead of per change is a different procedure.

## 6. The release procedure

A release document outranks everything here: `docs/release.md`, `RELEASING.md`,
`CONTRIBUTING.md`'s release section, `docs/development.md`, a `publish.yml` job, or
a `release` script in the manifest. Read it for the version's single source, the
link-reference update, the tag format, and the push and publish order. It is
normative — this skill contributes the changelog steps, not a competing order.

## 7. The check and the guard

The project's check command (`bun run check`, `npm test`, `make check`, a CI
workflow) is the finish line for any edit. A guard on the changelog itself is worth
finding by name: `release.test.ts`, `changelog.test.ts`, a `changelog` lint script,
or a CI step asserting that the version, the newest dated heading, and the newest
tag agree. Run the guard directly while iterating; a failing guard names the rule
you just broke.

## State the profile

Before editing, write one short paragraph — file, categories and order, scope prefix,
when the entry lands, the release document, the check. It is how the user catches a
misread in one line instead of in a diff. Do not invent a rule the project never
stated; ask instead.

## A worked example

When you are in this repository, the answers are already written down:

- `CHANGELOG.md` — Keep a Changelog preamble, categories in the standard order,
  `[Unreleased]` kept in the file, scope in backticks followed by a colon.
- `AGENTS.md` — the entry lands in the same commit as the change; a behavior change
  also updates the catalog table in both entry READMEs and the relevant `docs/` guide.
- `docs/development.md` — the normative release procedure: version bump, link refs,
  tag and push order.
- `test/release.test.ts` — the guard on subsection names, order, emptiness, and the
  version pin against the newest tag.
- `bun run check` — the finish line; `bun test test/release.test.ts` for the guard
  alone.

The paths are named, not linked, because this skill also ships in an npm package
where `docs/` and `test/` are not included.
