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

Before editing, find:

- the changelog file and its preamble;
- the category spelling and order;
- the scope prefix, and whether one bullet per extension or module is required;
- whether the entry belongs in the same commit as the change;
- the release document, version bump, link refs, and tag/push/publish order;
- the check command and any release-consistency test.

State the profile in one short paragraph. Do not invent a rule the project never
stated; ask instead.

## 2. Draft before implementing

For a new feature, draft the bullet in the plan or a scratchpad, not in
`CHANGELOG.md`.

- Write one line in the project's shape: ``- `scope`: <what the user can now do>``.
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
- Re-read immediately before editing, append within the category, and preserve
  other bullets and concurrent edits. Never create a second category heading.

Good:

```text
- `billing`: invoices now show the tax line separately.
- `config`: `oldKey` is no longer read; run `bun run config:migrate`.
```

Bad:

```text
- `billing`: refactored invoice rendering and added tests.
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

Follow the project's release document; it is normative. This is a checklist, not
a replacement:

- Confirm the version and the SemVer reason with the user.
- Move every `[Unreleased]` entry under `## [X.Y.Z] - YYYY-MM-DD`; leave an empty
  `[Unreleased]` heading.
- Bump every manifest and update the compare and release link refs.
- Run the project's release checks.
- Tag, push, and publish only with explicit approval, in the project's order.
- Keep the release commit mechanical: no behavior, code, or unrelated docs.
- Use that section as the release body; do not add extra prose.

## 7. Quality gate

- One bullet per user-visible change; every bullet starts with a scope and a user
  outcome.
- No internal-only or duplicate entries, and no empty category headings.
- No entry for a change that shipped before its heading.
- Links and versions agree; the project check passes.

## 8. Report and stop

Say what was recorded, what the audit found, or what the release moved. List what
was deliberately left out and why. When nothing qualifies, say so. Stop before
editing if the project rules are missing or contradictory; ask instead.
