/**
 * The browser suites, declared once.
 *
 * A suite that drives Chrome costs roughly two hundred milliseconds a case — a document, a click,
 * a read — where a suite that reads the same page as a string costs two milliseconds for all of
 * them. Forty files therefore decide what `bun run check` feels like, and the one hand-kept list of
 * seven of them (in `test/wait-budget.test.ts`) meant the other thirty-three were counted by nobody:
 * the hook rule said "every browser suite" and covered a sixth of the layer.
 *
 * A value module rather than a contract, because two contracts read it — the hook rule in
 * `test/wait-budget.test.ts`, and the declaration check in `test/browser-budget.test.ts`, which
 * proves the list matches the tree in both directions. A `*.test.ts` cannot hold it: a test file
 * imported by another test file runs its cases twice, and `test/layout.test.ts` allows `test/` to
 * hold only helpers and package-level contracts.
 *
 * The tier — skipping this layer outside CI, the way `./slow-suite.ts` gates the git suites — lives
 * in {@link SMOKE_SUITES} below. It cannot arrive as a line in each suite: `test/suite-sizes.test.ts`
 * names three of them at their exact height and holds a fourth at the 400-line bar, so it comes from
 * the runner (`scripts/check.ts`) instead.
 */

/** Every suite that boots a browser, repo-relative. The hook rule and the declaration read this. */
export const BROWSER_SUITES: readonly string[] = [
	"extensions/board/view/behaviour.test.ts",
	"extensions/board/view/chrome.test.ts",
	"extensions/board/view/dialog-behaviour.test.ts",
	"extensions/board/view/face.test.ts",
	"extensions/board/view/fields-behaviour.test.ts",
	"extensions/board/view/filter-behaviour.test.ts",
	"extensions/board/view/header-behaviour.test.ts",
	"extensions/board/view/kind.test.ts",
	"extensions/board/view/lane-heads.test.ts",
	"extensions/board/view/machines.test.ts",
	"extensions/board/view/plan-row-behaviour.test.ts",
	"extensions/board/view/queue.test.ts",
	"extensions/board/view/queue-row-facts.test.ts",
	"extensions/board/view/repaint.test.ts",
	"extensions/board/view/run-row-behaviour.test.ts",
	"extensions/board/view/team-mail.test.ts",
	"extensions/board/view/team.test.ts",
	"extensions/code-review/view/chrome.test.ts",
	"extensions/code-review/view/drafts.test.ts",
	"extensions/code-review/view/face.test.ts",
	"extensions/code-review/view/interaction.test.ts",
	"extensions/code-review/view/live.test.ts",
	"extensions/code-review/view/rail-row.test.ts",
	"extensions/code-review/view/threads.test.ts",
	"extensions/code-review/view/writes.test.ts",
	"extensions/file-browse/view/palette.test.ts",
	"extensions/file-browse/view/subject-behaviour.test.ts",
	"extensions/plan/web-band.test.ts",
	"extensions/plan/web-behaviour.test.ts",
	"extensions/plan/web-blocks.test.ts",
	"extensions/plan/web-controls.test.ts",
	"extensions/plan/web-drafts.test.ts",
	"extensions/plan/web-jump.test.ts",
	"extensions/plan/web-live.test.ts",
	"extensions/plan/web-narrow.test.ts",
	"extensions/plan/web-outline-live.test.ts",
	"extensions/plan/web-rail.test.ts",
	"extensions/plan/web-shortcuts.test.ts",
	"extensions/plan/web-switch.test.ts",
	"extensions/plan/web-view.test.ts",
];

/**
 * The tier: the browser suites a local gate keeps, one served page each.
 *
 * `bun run check` ignores the rest of the layer, because a landing pays this gate on every branch,
 * while `check:all` and CI run all of `BROWSER_SUITES`. These three are measured on one machine —
 * interaction 4.17 s, web-behaviour 4.32 s, queue 5.24 s — against `behaviour.test.ts` at 26.58 s and
 * `mission.test.ts` at 47.09 s, which is why the tier is a list and not "the page suites".
 *
 * A suite not named here runs locally until it is named: the gate's ignore list is `BROWSER_SUITES`
 * minus this one, so **an addition costs time and never coverage** — a slow local gate after a new
 * page suite is this line to move, not a defect.
 */
export const SMOKE_SUITES: readonly string[] = [
	"extensions/board/view/queue.test.ts",
	"extensions/code-review/view/interaction.test.ts",
	"extensions/plan/web-behaviour.test.ts",
];
