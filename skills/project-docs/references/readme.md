# Readme

The front door is the only document a reader is guaranteed to see, so it carries two
burdens at once: it must be *enough* on its own, and it must not become the manual. This
mode keeps it true to the tree without letting it grow.

Read [`discovery.md`](./discovery.md) first for the file, its mirror, and the guides it
links to.

## What belongs on the front door

- What the thing is, in one or two sentences a stranger can act on.
- Install, and the first command that proves the install worked.
- The catalog: one row per capability, grouped by what the reader is trying to do.
- Configuration that a reader must choose before the first run, and where the rest
  lives.
- Links onward to the guides, and the license.

What does not belong: a tool's parameter table, an exhaustive options list, an internal
architecture, or a tutorial. When a row needs three sentences of mechanism, the
mechanism belongs in a guide and the row links to it — do not copy the guide up, and do
not let the row become a summary of a summary.

## Rows and counts belong to the tree

- Every row names something that exists and is spelled the way the code spells it: the
  tool, the command, the flag, the file. A renamed tool with an unchanged row is a
  broken promise to the reader who types it.
- Every count the page states — extensions, tools, skills, themes, formats — is read
  from the tree. A project with a guard that derives it has the number already: change
  the tree, or the guard, never the number in the prose.
- A capability with no row is invisible; a row with no capability is a lie. Both
  directions, in the same pass.

## Examples must run

Run the quickstart as written, in a clean directory, before editing anything else on the
page. The first command is the most expensive promise on the page: a broken one costs
the reader the whole document. Then check the worked example — an import, a
configuration snippet, a call — against the current surface, and prefer the shortest
form that still runs.

## The mirror

A translated front door is the same document in another language: the same sections,
the same table rows in the same order, the same relative links. Prose is translated;
structure is not. A row added to one and not the other is a finding, and the count on
both sides is the tree's.

## Screenshots and assets

An image is a claim about a surface. Recapture it when the surface changed — and only
then, because a stale frame is worse than no frame and a fresh frame is expensive to
produce. Check that the alt text describes what the frame now shows, that the image is
referenced by a relative path, and that an image whose feature was removed is deleted
rather than left unreferenced.

## Report

Say which rows, counts, examples, and images moved, and which claims you could not check
without running the product. A front door that matches the tree already is a valid
result; say what you verified — the command you ran, the counts you derived — and stop.

## In this repository

- `README.md` is the front door and `README.zh-CN.md` mirrors it section for section;
  `test/docs-parity.test.ts` holds the two to the same headings, table rows, and links,
  and derives the catalog's counts from the tree.
- `test/extension-load.test.ts` pins every count the pages state — extensions, tools,
  skills, themes — against what actually loads and ships, and requires a row in both
  entry READMEs for every packaged skill.
- `assets/` holds the frames the pages show; `bun run screenshots` recaptures one, and a
  frame is only recaptured when its surface changed.
- Deep detail lives in `extensions/<name>/README.md`, `lib/README.md`, and `docs/`; the
  front door links there and does not restate them.

The paths are named, not linked, because this skill also ships in an npm package where
`docs/`, `test/`, and `assets/` are not included.
