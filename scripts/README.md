# scripts

The dev tooling: the commands `package.json` exposes and the modules they share.
Nothing here ships — `files` in `package.json` decides that — so a change is
judged by `bun run check` and by the assets it writes under `assets/screens/`,
`assets/cards/`, `assets/tools/`, and `assets/video/`.

## Commands

A name is a verb when the verb is the whole errand (`check`, `format`), or `<verb>:<target>` for
one member of it, so a command says what kind of work it is before it says what it is about.
`package.json` repeats no name twice and no value calls another script: each row names the file
it runs. `test/scripts-surface.test.ts` holds both halves — the verbs this surface has, and the
rule that a value is a path.

| Command | What it does |
|---|---|
| `bun run check` | The gate a landing needs: `check:format`, `check:types`, and the tests, the first two running beside the test phase through `scripts/check.ts` so the gate costs what its longest phase costs. One scope flag narrows the tests: `--static` (the static half alone), `--serial` (one file at a time, what CI's Linux and macOS jobs run), `--watch`, `--changed [--base <ref>]` (the tests a change reaches), `--ext <name…>`, `--lib <area…>`, `--root` (the package-level tests), `--slow` (the gated git suites). `--dry-run` prints the selection and runs nothing. It holds a machine-wide lock while it runs, so a second gate on the same machine waits rather than starving this one's spawns; `--no-lock` runs beside it. A red test phase names its cases as `file:line — suite > case` and leaves `bun`'s JUnit report at `.pi/cache/test-report.xml`; the red run is the one `test/README.md` describes. |
| `bun run check:format` | `biome format .` — the read-only half of `format`, and one of the three phases `check` runs. |
| `bun run check:types` | `tsc --noEmit` — one of the three phases `check` runs. |
| `bun run check:tests [scope]` | The tests alone, with every scope flag `check` takes; no flag is every test, in parallel. |
| `bun run format` | `biome format --write .`. |
| `bun run bench:render` | Render 500 and 2000 tool blocks at 80 and 120 columns through the real renderers and report lines, median/p95 frame time, heap per frame, and memo hits. Gates determinism; the timings are a pre-release reading. |
| `bun run bench:load` | Report what a load costs, per extension: the local modules its entry evaluates at registration, how many of them are `lib/` and how many another entry pays again, and what that graph costs to import. Gates the graph only; the timings are a pre-release reading. |
| `bun run render:tools <list\|render\|html\|gallery\|tools>` | The tool-renderings CLI: `list` names every rendering, `render <name> --width n` prints one block as ANSI on any OS, `html <out>` writes the gallery page, and `gallery <out>` / `tools <dir>` capture PNGs with Playwright driving the local Chrome. `capture:tools` and `capture:tool-pngs` are the last two with their asset paths filled in. Set `PI_CHROME` for a non-default Chrome. |
| `bun run capture:screens [name…]` | Regenerate the screenshots and hero under `assets/screens/` (macOS only); naming screens captures only those. |
| `bun run capture:board [--out <dir>]` | Render the board page and capture both tabs as full-page PNGs with Playwright driving the local Chrome. It starts the shipped board server over a fixture store in a temporary directory, so the image never names a real checkout; `--out`, `--width`, `--scale`, `--theme light\|dark`, `--wait`, and `--dialog card` (the card dialog — card 1, the fixture's fullest record — instead of the two tabs) tune the shot. Set `PI_CHROME` for a non-default Chrome. |
| `bun run capture:file-browse [--root <dir>]` | Render the loopback file browser's file page and capture it as a full-page PNG with Playwright driving the local Chrome. Without `--root` it serves a generated fixture project, so the image never names a real checkout; `--file`, `-o`, `--width`, `--scale`, `--theme light\|dark`, and `--wait` tune the shot. Set `PI_CHROME` for a non-default Chrome. |
| `bun run capture:plan` <plan.md> | Render one plan through the browser review page and capture it as a full-page PNG with Playwright driving the local Chrome, for checking a plan's Markdown layout. `-o`, `--width`, `--scale`, `--theme light\|dark`, and `--wait` tune the shot, and `--as owner\|reviewer\|viewer` picks the owner's page, the one a shared link opens, or the read-only view `/plan list`'s Enter opens — which has no composer, no dialog and no link to post through, so `--post`, `--draft` and `--share` are refused with it. `--post <name>` posts one comment as that reviewer before the capture, so the frame shows the name bound to her link, and `--draft <text>` starts the tab with one unsaved comment, the state a reload restores; `--share` opens the owner's Share dialog with two links instead of the plan, so the per-person list is what the frame shows. Set `PI_CHROME` for a non-default Chrome. |
| `bun run capture:cards [flow\|graphic\|board\|team\|parallel\|wechat\|ends]` | Capture the posting cards at 2× by default: the plan pair — `assets/cards/plan-flow.html`, prose-led, and `plan-flow-graphic.html`, graphic-led — the board three — `board.html`, the five lanes, one card's atoms and the lead's round, `board-team.html`, the three `team` verbs, and `board-parallel.html`, three cards planned side by side and then executed side by side, each row crossing the `approve` and `review` lines — `wechat.html`, one Pi session drawn between its two windows, the terminal and the phone — and `ends.html`, the set's product poster — three windows on one session in which the browser widens what the terminal shows and WeChat widens where it takes input, and the only card drawn at 1200×1500, the tallest frame a timeline shows uncropped, so it stops a feed reader who has never run the pack. Naming cards captures only those, and `-o` names the output for a single card; `--scale` and `--wait` tune the shot, and a card whose content outgrows its box fails the run instead of being captured clipped. Set `PI_CHROME` for a non-default Chrome. |
| `bun run capture:video` | Regenerate `assets/video/demo.mp4`, the `pi.video` gallery preview: six frames this repository already ships, cross-faded with one caption each, drawn on a canvas and encoded to H.264 by the local Chrome (`MediaRecorder`), so no video encoder is installed for it. `-o`, `--width`, `--height`, `--fps`, and `--bps` tune the shot; the storyboard is `MONTAGE` in `scripts/shots/video.ts`. Set `PI_CHROME` for a non-default Chrome. |
| `bun run capture:tools` | Regenerate the tool call/result gallery (`assets/screens/tool-renderings.png`) with Playwright driving the local Chrome: every tool the package registers plus Pi's built-ins, each rendered by its real renderer through the shipped block frame. It is `bun run render:tools gallery assets/screens/tool-renderings.png`. |
| `bun run capture:tool-pngs` | Regenerate the one-PNG-per-tool files under `assets/tools/` from the same renderings. |
| `bun run report:versions` | Print the Pi peer versions this tree resolves to; the compat job records them, and it writes a markdown table to `$GITHUB_STEP_SUMMARY` when GitHub sets one. |
| `bun run report:notes X.Y.Z` | Print one changelog section for `gh release create`. |
| `bun run sync:docs [--dry-run]` | Make `docs/assets/` hold exactly the images the site's pages reference: each one is copied from this repository's `assets/`, a file no page names is removed, and a reference with no source (the `chrome.webp` derivative) is left alone. `--dry-run` prints the same table and writes nothing. |
| `bun run migrate:config [--project <dir>]` | Move each per-extension `<name>.json` into the shared `bytefly.json`, once per machine and repository; `--dry-run` previews and `--keep` leaves the old files. How it behaves is in [`docs/configuration.md`](../docs/configuration.md#migrating-from-older-versions). |

## Layout

| Path | What it is |
|---|---|
| [`screenshots.ts`](./screenshots.ts) | The capture command: `render <name>` prints one frame as ANSI on any OS, a named screen captures only it, and no argument captures every frame, the hero among them. |
| [`screens/`](./screens/) | The frames: `index.ts` is the registry — the `Screen` type and `SCREENS`, which holds every capturable frame including the `chrome` hero — `fixtures/` is the data they draw around, one module per surface, and `frames.ts` reads and writes `frames.json`, the fingerprint of the frame each capture was taken of. |
| [`capture/`](./capture/) | The two mechanisms. `terminal.ts` drives Terminal.app and `screencapture`; `chrome.ts` and `page.ts` drive Playwright against the local Chrome; `crop-title-bar.js` is the JXA crop, run by `osascript`. |
| [`shots/`](./shots/) | One CLI per captured page — `board`, `file-browse`, `plan-review`, `cards` — plus `plan-review-capture.ts` for the review page's state, and `video.ts`, the montage that is the `pi.video` gallery preview. |
| [`tools/`](./tools/) | The tool-renderings CLI (`list`, `render`, `html`, `gallery`, `tools`) and `fixtures/`, one fixture per registered tool. `fixtures/board-store.ts` is the one module that is not a fixture: it seeds a board in a temp directory, and `test/helpers/board-page.ts` serves the shipped page over it, which is why the gallery, the picture, and the browser suite describe the same cards. |
| [`examples/`](./examples/) | Sample inputs a documented command takes, such as `plan-review.md` for `capture:plan`. |
| [`cli.ts`](./cli.ts), [`theme.ts`](./theme.ts), [`poll.ts`](./poll.ts), [`ansi-html.ts`](./ansi-html.ts), [`transcript-fixture.ts`](./transcript-fixture.ts) | Shared: flag parsing, the capture theme and page palette, sleep and polling, the ANSI-to-HTML bridge, the transcript fixture. |
| [`junit.ts`](./junit.ts) | The red gate's report: `reportPath` (`.pi/cache/test-report.xml`), `readReport` — a bounded scan of bun's JUnit XML for the run's totals and the cases carrying a `<failure>`, not a general parser — and `reportDigest`, the `file:line — suite > case` lines a failing test phase prints. `check.ts` is its only caller. |
| [`check.ts`](./check.ts), [`test-selection.ts`](./test-selection.ts), [`check-lock.ts`](./check-lock.ts) | The gate, `bun run check` / `bun run check:tests`: its phases at once, its exit code the one that matters, and the scope flags it takes — which `test-selection.ts` answers from the manifest and the import walker. `check-lock.ts` is the one-gate-per-machine lock it holds while it runs. What a scope covers is [`test/README.md#running`](../test/README.md#running). |
| `migrate-config.ts`, `release-notes.ts`, `peer-versions.ts`, `render-bench.ts`, `load-bench.ts` | One command each, under [Commands](#commands). |
| [`docs-assets.ts`](./docs-assets.ts) | The site's copies: `siteImages` reads the image each page references, resolved from the page's URL rather than its file, and `syncDocsAssets` copies what is missing or stale and removes what no page names. `test/site-docs.test.ts` reads the same rule, so the guard and the command cannot disagree. |

## The two capture mechanisms

A **terminal frame** is macOS-only: it is drawn by the shipped component with the
`bytefly-dark` theme inside a real Terminal.app window and captured with
`screencapture`, so the docs show the product rather than a mock. `bun run check`
renders every frame at three widths and fails when one leaves the terminal or
outgrows its `rows`, so a layout break is caught in CI even though no window can
be opened there. The capture also cuts Terminal's title bar off — its last
segment is the capture command's argv — and refuses a frame whose top row is not
the theme canvas, so a macOS that grows the bar stops the capture instead of
leaving a light seam down the picture.

A **browser page** is headless: Playwright drives the Chrome the machine already
has — `PI_CHROME`, else the usual bundles and the paths the three CI images use,
which is what lets a test drive the board page there too (`findChrome()` answers
`undefined` instead of throwing, so a test can skip and a capture cannot) — sizes
the window to the document before capturing, and sets the theme through the page's
own toggle so the header glyph and the page stay in step. Each page capture has a
fixture or a fixture project, so a refresh reproduces the same example.

Which mechanism an asset uses follows where it is drawn: a TUI component is a
frame in `screens/`, a page the package serves is a CLI in `shots/`, and the tool
galleries are `tools/`.

A **video** is neither, and is the only asset drawn from assets rather than from a
fixture: `shots/video.ts` is handed the frames above, one caption each, and the
Chrome it drives draws them on a canvas and encodes the result, because the
machine has no video encoder and the preview must be reproducible from a clean
checkout. Its storyboard is the list that decides what the file shows.

## Fixtures

`screens/fixtures/` and `tools/fixtures/` hold hand-written data for a real
component, so a capture is reproducible and a test can render a frame without a
window. `examples/` differs in kind: it holds an input a command is given, not a
fixture the code imports. A new fixture goes in the directory of the mechanism
that draws it.

## When an asset is recaptured

- When its surface changed, or when a version it prints is behind. Nothing else.
- `assets/screens/chrome.png` prints two versions: the pack's, from `package.json`, and
  the host's, `VERSION` from `@earendil-works/pi-coding-agent`, which resolves
  through `bun.lock`. The hero therefore names the **compatibility floor**, not
  the `pi` on `PATH`, so a release recaptures it — and so does a floor raise.
- Every asset, the hero included, is drawn from a fixture by the shipped
  component, so a capture is reproducible: the same code renders the same frame,
  and a diff in the image is a diff in the product. Read the diff, not the
  checksum — two captures of one page sit 22 pixels apart at 1/255 each, which is
  rounding — and a diff in a word, a number, or a layout is a real one. A page
  that changed leaves its card behind until it is captured again. The hero is
  the `chrome` frame — the header, the key-hint rows, a nameplated message with
  its answer and an edit diff, the notice, the turn rule, the goal and todo
  rails, and the footer — padded to the window a session fills.
- A capture needs a real Terminal.app window, which is why CI cannot produce one
  and the release step names it.
- `assets/video/demo.mp4` is made of six of those assets, so it is stale the
  moment one of them is recaptured and nothing can tell: two encodes of the same
  frames do not match byte for byte. `bun run capture:video` re-montages them,
  and the storyboard names which six.

## A script a doc names

A doc may only say `bun run <name>`: give the script a `package.json` entry and a
row in the [Commands](#commands) table here.
A `bun run` aimed at a file path rather than a declared script is refused by
`test/scripts-surface.test.ts`, so a command cannot be documented without being
discoverable and renameable.
