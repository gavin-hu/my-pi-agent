# Record one bullet

This mode writes one thing: a bullet in the changelog for a change that just landed.
It does not decide whether something shipped, and it does not curate a release — that
is the `release` mode, and only for a version the user named.

Read [`discovery.md`](./discovery.md) first for the file, the categories, their order,
the scope spelling, and whether the entry ships with the change. Where a tool owns the
file — `semantic-release`, `changesets`, `git-cliff`, or a step in the release workflow —
this mode does not write it: the entry belongs upstream, in the commit message's
convention, a changeset fragment, or the generator's config.

## Where the bullet goes

- Re-read the changelog before editing: another session, another contributor, or the
  user may have written since the state script ran.
- Under `[Unreleased]`, in the category the project uses for this kind of change, in
  the file's own order and spelling. Never create a second heading for a category that
  already exists in the section.
- When the file keeps no `[Unreleased]` section, ask where the change is recorded — the
  preamble decides, and a project that writes entries only at release has a different
  procedure.
- Insert without disturbing any other bullet, keep the file's wrap column, and write it
  in the same commit as the change it describes.

## Does it qualify

It qualifies when a user can observe it: behavior, a CLI or tool or command surface, a
config default, packaging and dependencies a user installs, security, or a documented
promise that is now true or false.

It does not qualify when only the implementation moved: an internal refactor, a rename
with no behavior change, a test, formatting, a comment, a dependency bump with no
behavior change, or a typo fixed in the changelog itself.

When a change is both — a refactor that also fixes a rounding bug — the bullet is the
rounding bug, and the refactor is not mentioned.

## One outcome, one bullet

- A feature and the bug it fixed before release are one bullet: users never saw the
  broken version.
- Two observable changes are two bullets, even in one commit.
- Two commits that produce one outcome are one bullet, written where the outcome became
  true.
- A breaking change is its own bullet with the required action; do not bury it in a
  feature's sentence.

When the outcome is unclear, ask. Reading the diff tells you what changed; only the
author knows what a user will notice.

## The shape

Follow the file's newest released section. Where the project states nothing, the shape
is one bullet that leads with the scope in backticks, a colon, then what the user can
now do:

```text
- `billing`: invoices show tax as a separate line. Amounts that used to be bundled
  into `total` are summed on the printed total, so an invoice stored by an older
  release still reconciles.
- `cli`: `--legacy-auth` is no longer read; run `mytool migrate auth` first.
```

- **Scope**: the area a user would name — an extension, package, module, or subsystem,
  in the project's own spelling. Never a file path, a function, or a ticket number. A
  bullet with no scope is a defect where the project uses scopes, and noise where it
  does not.
- **Outcome first**: what is different for the user, then the mechanism if it matters,
  then any action they must take.
- **Length**: a bullet may run to several sentences when the outcome needs them — what
  the user sees, what it replaced, what to do about it. Brevity is not the goal;
  vagueness is the defect.
- **Voice**: match the file. Most changelogs are present tense and third person; do not
  switch to marketing, and do not add praise for the change.
- **Wrap**: match the file's column, usually near 80, and let one bullet be one
  paragraph.

## What does not belong

File names and paths, internal helper names, test counts and coverage, commit hashes
and pull-request numbers as the subject (a link at the end is fine where the file does
it), and empty words such as "various", "improvements", "cleanup", "refactor", "misc".
A reader who cannot tell from the bullet whether the change affects them has been told
nothing.

## The two failure modes

```text
- `billing`: refactored invoice rendering and added tests.
- `misc`: improvements.
```

The first names no outcome and reports the implementation. The second names no scope,
no outcome, and would fit any release.

```text
- `api`: `POST /v2/charge` now refuses an amount with more than two decimals
  instead of truncating it, so a client that relied on the old rounding sees a
  `422` with `code: "amount_precision"`. Truncation moved to `POST /v2/charge/draft`,
  which is what the old behavior should have been.
```

Three sentences, one outcome, one scope, and the migration named. Long is fine when
each sentence tells the reader something they must know.
