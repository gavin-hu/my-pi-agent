# Release

Only when the user asked for a specific version. A release is a promise: a tag, a
published artifact, and a section of the changelog that says what is in it. The
project's release document owns the whole procedure; this file adds the changelog
steps and the order they fit into, not a competing one.

## Before touching the file

1. Read the project's release document — `docs/release.md`, `RELEASING.md`,
   `CONTRIBUTING.md`'s release section, `.github/workflows/publish.yml`. It decides
   the files to bump, the tag format, and the push and publish order.
2. Confirm the version and the reason with the user. Say the reason in SemVer's
   terms: a fix with no surface change is a patch, an additive surface is a minor, a
   breaking change is a major — and ask when a project in `0.x` treats minors as the
   breaking channel, because many do. Never infer a version from the size of the
   diff and never raise the version in the release without the user's word for it.

## Move the entries

- Read `[Unreleased]` and check it is what the release contains: everything since
  the last tag, nothing that already shipped.
- Move every entry under `## [X.Y.Z] - YYYY-MM-DD`, categories in the file's own
  order and spelling, creating only the categories that hold an entry. Keep each
  bullet's text; a release is a move, not a rewrite.
- Leave `[Unreleased]` present and empty, unless the file's preamble says it is
  removed between releases. An empty heading is how the next change knows where to
  land.
- Update the link references: `[Unreleased]` now compares from the new tag, and the
  new version gets a reference in the file's existing style (`compare/vOLD...vNEW`
  or `releases/tag/vNEW`).
- Bump the version where the project keeps it — usually one manifest, sometimes a
  lockfile, a version file, and an install pin. The build manifest and the newest
  dated heading must agree, or a consistency guard fails.
- The release commit holds the changelog move, the version bump, and the link refs.
  No behavior, no new entries, no unrelated docs: a release commit that also changes
  code cannot be diffed as a release.

## Finish

- Run the project's release guard (often `release.test.ts` or a `changelog` check),
  then the project's full check. The guard is the one test that names a version, so
  run it directly while iterating.
- Then, in the project's order and only with explicit approval for that push: commit,
  tag (`vX.Y.Z`, annotated where the project does that), push the tag together with
  the branch — a branch push that lands before its tag races the checkout that
  asserts they agree — and publish through the project's pipeline, not a local
  publish.
- The release body is that section verbatim, heading included. Do not add a summary,
  a thank-you, or a rewrite of the bullets a reader already has.

## After

If a shipped change turns out to have no bullet, do not edit the released section.
Record the gap to the user and add a bullet to `[Unreleased]` for the next release,
naming the fix; a released section is a record of what was published, not a draft.
