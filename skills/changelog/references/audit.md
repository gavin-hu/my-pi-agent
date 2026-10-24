# Audit

Read-only. The audit answers one question per commit: is a user-visible change
shipped with no bullet, a wrong bullet, or no bullet needed? It never edits; if the
user asks for the fixes, finish the report first and then return to Record, adding
only the entries the evidence supports.

## Steps

1. Run `scripts/state.ts` (see the skill's *Start here*). It gives the file, the
   last tag, the commits since it, the `[Unreleased]` categories, and the scopes in
   use.
2. Read every commit it lists: `git show <sha>` for the diff, or the pull request
   when the repository squashes. A subject line is not enough — `fix bug` and
   `wip` hide user-visible changes, and `feat: rewrite the config loader` is often
   invisible to users.
3. For each commit, decide: is it user-visible, which existing bullet covers it, is
   that bullet's scope right, is its outcome accurate — and would a user reading
   only the bullet know what changed for them?
4. Report the table, then the findings.

## The table

| Commit | User-visible | Evidence | Existing entry | Action |
|---|---|---|---|---|
| `3f19a02` | yes | `src/load.ts:42` now rejects an unknown key | — | add |
| `b81c4de` | no | test-only | — | leave |
| `0ad9f12` | yes | retry limit 3 → 5 | `Changed`: "`api`: retries are now bounded" | update: the bullet never names the limit |
| `77e0a1e` | unclear | touches the public `--json` shape | — | ask |

`Action` is one of:

- **add** — user-visible, no bullet.
- **update** — a bullet exists and is wrong, unscopeable, or too vague to act on.
- **leave** — covered, internal, or correctly recorded under an older release.
- **ask** — the outcome depends on intent the diff cannot show.

"No entry found" is a valid result for the whole audit. Say what you checked and
stop; an audit that invents four entries to look thorough is worse than one that
finds nothing.

## Findings to report separately

- Duplicate `##` or `###` headings — some tools render the second as a separate
  section, and a reader sees half the entries.
- An empty category heading, or a bullet whose category a `release.test.ts`-style
  guard rejects.
- An `[Unreleased]` heading that is missing or empty while the commits since the tag
  contain user-visible changes.
- An entry for something that already shipped under a dated heading: the same
  outcome twice, which reads as a second change.
- A stale `[Unreleased]` link reference pointing at an older tag than the newest
  dated heading.

What the audit cannot see, and should say so rather than guessing: whether a change
is user-visible to a user the diff does not show (a default that only matters for
one platform, a behavior the docs promised), and whether an outcome described in a
commit message matches the code. Name the ones you were unsure about in a closing
line instead of silently dropping them.
