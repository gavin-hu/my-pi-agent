/**
 * What each browser suite may cost, in seconds, and the layer's total.
 *
 * `bun run bench:browser` times each file and holds it to its ceiling. The numbers are a measured
 * value plus half again: wall clock is not deterministic the way a line count is, and a file that
 * merely ran on a loaded machine must not redden a landing. That makes them a ratchet rather than
 * a stopwatch — a file over its ceiling is a case that got slower or an interaction that started
 * waiting, and naming it here is the deliberate act the gate asks for. A ceiling may only fall,
 * and the total is held separately so forty small regressions cannot hide behind forty green files.
 *
 * Seeded by #899 from its own readings, each file run alone with its own launch: the layer fell
 * from 108.65 s to 57 s there, and these are those per-file numbers at 1.5x.
 */

/** Each file's ceiling in seconds. A file with no entry fails the bench. */
export const BROWSER_FILE_BUDGET_S: Readonly<Record<string, number>> = {
	"extensions/board/view/behaviour.test.ts": 7.5,
	"extensions/board/view/chrome.test.ts": 1.7,
	"extensions/board/view/dialog-behaviour.test.ts": 3.4,
	"extensions/board/view/face.test.ts": 1.7,
	"extensions/board/view/fields-behaviour.test.ts": 1.7,
	"extensions/board/view/filter-behaviour.test.ts": 1.4,
	"extensions/board/view/header-behaviour.test.ts": 1.8,
	"extensions/board/view/kind.test.ts": 1.8,
	"extensions/board/view/lane-heads.test.ts": 1.5,
	"extensions/board/view/machines.test.ts": 1.5,
	"extensions/board/view/plan-row-behaviour.test.ts": 1.9,
	"extensions/board/view/queue-bands.test.ts": 4.1,
	"extensions/board/view/queue-row-facts.test.ts": 2.1,
	"extensions/board/view/repaint.test.ts": 12.9,
	"extensions/board/view/run-row-behaviour.test.ts": 1.7,
	"extensions/board/view/team-mail.test.ts": 1.6,
	"extensions/board/view/team.test.ts": 2.5,
	"extensions/code-review/view/chrome.test.ts": 2.0,
	"extensions/code-review/view/drafts.test.ts": 3.2,
	"extensions/code-review/view/face.test.ts": 1.5,
	"extensions/code-review/view/interaction.test.ts": 6.3,
	"extensions/code-review/view/live.test.ts": 1.9,
	"extensions/code-review/view/rail-row.test.ts": 1.8,
	"extensions/code-review/view/threads.test.ts": 3.4,
	"extensions/code-review/view/writes.test.ts": 3.9,
	"extensions/file-browse/view/palette.test.ts": 3.0,
	"extensions/file-browse/view/subject-behaviour.test.ts": 2.1,
	"extensions/plan/web-band.test.ts": 2.9,
	"extensions/plan/web-behaviour.test.ts": 6.5,
	"extensions/plan/web-blocks.test.ts": 1.7,
	"extensions/plan/web-controls.test.ts": 2.4,
	"extensions/plan/web-drafts.test.ts": 3.3,
	"extensions/plan/web-jump.test.ts": 2.0,
	"extensions/plan/web-live.test.ts": 2.2,
	"extensions/plan/web-narrow.test.ts": 3.8,
	"extensions/plan/web-outline-live.test.ts": 14.2,
	"extensions/plan/web-rail.test.ts": 1.9,
	"extensions/plan/web-shortcuts.test.ts": 3.8,
	"extensions/plan/web-switch.test.ts": 2.7,
	"extensions/plan/web-view.test.ts": 1.6,
};

/**
 * The layer's ceiling: the sum a run of every file may spend, measured the same way.
 *
 * 86.15 s was the second run — forty files, each alone, after the tab and pool work landed — so
 * this is that reading and about a sixth again, not the 112 s the seed first named.
 */
export const BROWSER_TOTAL_BUDGET_S = 100;
