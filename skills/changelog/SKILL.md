---
name: changelog
description: "Maintain a Keep a Changelog file: draft the candidate bullet before implementation, record one user-visible bullet in the same commit, audit commits since the last tag for missing or weak entries, and curate a release section from the project's own rules. Use when planning, writing, or auditing a changelog or preparing a release, not for ordinary code edits."
---

# Maintain the changelog

This is a procedure, not a second policy. Read the project's instructions first;
where they disagree with this skill, the project wins. There are four modes:
**draft** (before the code exists), **record** (the default once it does),
**audit**, and **release**. `/skill:changelog draft`, `... audit`, and
`... release` name the others; with no mode, infer draft versus record from
whether the behavior already exists.

## 1. Read the project profile

In this package the profile is written down; read it rather than rediscover it:

- [`../../CHANGELOG.md`](../../CHANGELOG.md) — the preamble, the scope prefixes,
  and the bullet shape in use;
- [`../../AGENTS.md`](../../AGENTS.md) — the entry lands in the same commit as the
  change, and a behavior change also updates the two entry READMEs and `docs/`;
- [`../../docs/development.md#release`](../../docs/development.md#release) — the
  normative release procedure: version bump, link refs, tag and push order;
- [`../../test/release.test.ts`](../../test/release.test.ts) — the guard on
  subsection names, order, emptiness, and the version pin.

Everywhere else, find the same six things: the changelog and its preamble, the
category spelling and order, the scope prefix and one-bullet-per-unit rule,
whether the entry ships with the change, the release document with its bump and
push order, and the check command with any release-consistency test.

State the profile in one short paragraph. Do not invent a rule the project never
stated; ask instead.

## 2. Draft before implementing

For a new feature, draft the bullet in the plan or a scratchpad, not in
`CHANGELOG.md`.

- Write one bullet in the project's shape: ``- `scope`: <what the user can now
  do>``. One outcome is the unit, not one line: a bullet may run several
  sentences.
- If you cannot state the outcome, or need several unrelated bullets, the feature
  is not scoped yet; split it or ask before coding.
- Name the intended category and any migration, breaking change, or required
  action now, while the scope is still open.
- Use the draft as the acceptance criterion: implementation is done when the
  behavior it describes is true and tested.
- Keep it out of the changelog until the code lands; a draft is not a shipped
  claim. Update it when the outcome changes, then move it into `[Unreleased]` in
  the same commit as the code (**Record**).

## 3. Classify the change

It qualifies when a user can observe it: behavior, a CLI/tool/command surface, a
config default, packaging, security, or a documented promise that is now true or
false.

It does not qualify when only the implementation changed: an internal refactor, a
rename, a test, formatting, a comment, or a dependency bump with no behavior
change.

One bullet per user-visible outcome. A feature and its bug fix before release can
be one bullet if users see one outcome; two observable changes are two bullets.
Ask when the outcome is unclear. Never invent an entry to make an audit look
complete.

## 4. Record

- Write the entry in the same commit as the change. If the change is already
  pushed without one, add a follow-up commit rather than rewriting history.
- Put it under `[Unreleased]` in `Added`, `Changed`, `Deprecated`, `Removed`,
  `Fixed`, or `Security`.
- Lead with what the user can now do or what changed; use the project's scope
  prefix; name a migration or required action explicitly.
- Exclude file names, internal helpers, test counts, commit hashes, and vague
  words such as "various" or "improvements".
- Match the file's voice and tense. Do not add marketing.
- A behavior change also updates its row in the catalog tables of
  [`../../README.md`](../../README.md) and
  [`../../README.zh-CN.md`](../../README.zh-CN.md) plus the `docs/` guide it
  belongs to; the changelog is this skill's subject, not its only file. A skill's
  change updates its `SKILL.md` and its README row together.
- Re-read immediately before editing, append within the category, and preserve
  other bullets and concurrent edits. Never create a second category heading.

Shape: one blank-line-separated bullet per outcome, wrapped near 80 columns, the
scope in backticks followed by a colon. The scope is the extension or module name,
spelled as this package spells it — `bytefly`, `plan`, `wechat`, `todo` — or
`lib`, `docs`, `test`, `ci`, `skills`. A bullet with no scope, or with a name the
package does not use, is a defect. A bullet may run several sentences — say what
the user sees, what it replaced, and any required action. Brevity is not the
goal; vagueness is the defect.

Good:

```text
- `config`: the report now says what its percentages are shares of. A
  `Composition · 11k estimate` header sits above the rows, and a disabled
  compaction no longer prints a headroom figure for a threshold that will never
  fire.
- `cli`: `oldKey` is no longer read; run `bun run config:migrate`.
```

Bad:

```text
- `config`: refactored invoice rendering and added tests.
- `misc`: improvements.
```

## 5. Audit (read-only)

1. Find the last tag: `git describe --tags --abbrev=0`, or the project's
   equivalent.
2. List the commits since it: `git log --oneline --no-merges <tag>..HEAD`. Read
   each diff with `git show`; a subject line is not enough.
3. For each commit, answer: is it user-visible? Which existing bullet covers it?
   Is the scope right? Is the outcome accurate?
4. Report a table:

   | Commit | User-visible | Evidence | Existing entry | Action |
   |---|---|---|---|---|

   `Action` is add, update, leave, or ask. "No entry found" is a valid result.

Also report duplicate `###` headings, empty categories, entries already shipped
under a released heading, and a missing or empty `[Unreleased]` when the commits
since the tag contain user-visible changes.

Do not edit during the audit unless the user asks. If they do, return to
**Record** and make only the entries the evidence supports.

## 6. Release (only when asked)

The project's release document is normative — in this package
[`../../docs/development.md#release`](../../docs/development.md#release), guarded
by [`../../test/release.test.ts`](../../test/release.test.ts). This is a
checklist, not a replacement:

- Confirm the version and the SemVer reason with the user.
- Move every `[Unreleased]` entry under `## [X.Y.Z] - YYYY-MM-DD`; leave an empty
  `[Unreleased]` heading.
- Bump every manifest and update the compare and release link refs, in the same
  commit as the movable part; the version in the manifest and the newest dated
  heading must agree or the release test fails.
- Run the project's release checks, then `bun test test/release.test.ts` for the
  version and subsection rules.
- Tag, push, and publish only with explicit approval, in the project's order. The
  order matters: push the tag with `main`, never after it.
- Keep the release commit mechanical: no behavior, code, or unrelated docs.
- Use that section as the release body (`bun run release:notes X.Y.Z` prints it);
  do not add extra prose.

## 7. Quality gate

- One bullet per user-visible change; every bullet starts with a scope and a user
  outcome, and may take several sentences to state it.
- No internal-only or duplicate entries, and no empty category headings.
- No entry for a change that shipped before its heading.
- Links and versions agree; the project check passes.

## 8. Report and stop

Say what was recorded, what the audit found, or what the release moved. List what
was deliberately left out and why. When nothing qualifies, say so. Stop before
editing if the project rules are missing or contradictory; ask instead.
