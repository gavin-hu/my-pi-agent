# scripts

The dev tooling: the commands `package.json` exposes and the modules they share.
Nothing here ships — `files` in `package.json` decides that — so a change is
judged by `bun run check` and by the assets it writes under `assets/screens/`,
`assets/cards/`, `assets/tools/`, and `assets/video/`.

## Layout

| Path | What it is |
|---|---|
| [`screenshots.ts`](./screenshots.ts) | The capture command: `render <name>` prints one frame as ANSI on any OS, a named screen captures only it, and no argument captures every frame, the hero among them. |
| [`screens/`](./screens/) | The frames: `index.ts` is the registry — the `Screen` type and `SCREENS`, which holds every capturable frame including the `chrome` hero — `fixtures/` is the data they draw around, one module per surface, and `frames.ts` reads and writes `frames.json`, the fingerprint of the frame each capture was taken of. |
| [`capture/`](./capture/) | The two mechanisms. `terminal.ts` drives Terminal.app and `screencapture`; `chrome.ts` and `page.ts` drive Playwright against the local Chrome; `crop-title-bar.js` is the JXA crop, run by `osascript`. |
| [`shots/`](./shots/) | One CLI per captured page — `board`, `file-browse`, `plan-review`, `cards` — plus `plan-review-capture.ts` for the review page's state, and `video.ts`, the montage that is the `pi.video` gallery preview. |
| [`tools/`](./tools/) | The tool-renderings CLI (`list`, `render`, `html`, `gallery`, `tools`) and `fixtures/`, one fixture per registered tool. `fixtures/board-store.ts` is the one module that is not a fixture: it seeds a board in a temp directory, and `test/helpers/board-page.ts` serves the shipped page over it, which is why the gallery, the picture, and the browser suite describe the same cards. |
| [`examples/`](./examples/) | Sample inputs a documented command takes, such as `plan-review.md` for `screenshot:plan`. |
| [`cli.ts`](./cli.ts), [`theme.ts`](./theme.ts), [`poll.ts`](./poll.ts), [`ansi-html.ts`](./ansi-html.ts), [`transcript-fixture.ts`](./transcript-fixture.ts) | Shared: flag parsing, the capture theme and page palette, sleep and polling, the ANSI-to-HTML bridge, the transcript fixture. |
| `wechat-poll.ts`, `migrate-config.ts`, `release-notes.ts`, `peer-versions.ts`, `render-bench.ts` | One command each, under [`docs/development.md#scripts`](../docs/development.md#scripts). |

## The two capture mechanisms

A **terminal frame** is macOS-only: it is drawn by the shipped component with the
`bytefly-dark` theme inside a real Terminal.app window and captured with
`screencapture`, so the docs show the product rather than a mock. `bun run check`
renders every frame at three widths and fails when one leaves the terminal or
outgrows its `rows`, so a layout break is caught in CI even though no window can
be opened there.

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
  frames do not match byte for byte. `bun run screenshot:video` re-montages them,
  and the storyboard names which six.

## A script a doc names

A doc may only say `bun run <name>`: give the script a `package.json` entry and a
row in the `#Scripts` table of [`docs/development.md`](../docs/development.md#scripts).
A `bun run` aimed at a file path rather than a declared script is refused by
`test/scripts-surface.test.ts`, so a command cannot be documented without being
discoverable and renameable.
