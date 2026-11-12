/**
 * The board page's chrome: the toolbar's zones, the bar under it, and the footer.
 *
 * Held apart from `pages.test.ts`, which is at its size bar: the document's *card* rules stay
 * there, and what the shell wears between its header and its footer is checked here — read from
 * the same served document, so the two suites cannot disagree about what a reader is given.
 *
 * The stream's own case needs a browser: it reads what the page offers once its server has gone.
 * Where the machine has none the case skips, naming `PI_CHROME`, so `bun run check` stays green
 * on a runner without Chrome and still says why nothing ran.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { WEB_THEME_TOKENS } from "../../../lib/web/index.ts";
import { contrast, over } from "../../../test/helpers/contrast.ts";
import { makeClock } from "../../../test/helpers/clock.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import { serveBoardPage } from "../../../test/helpers/board-page.ts";
import { boardDocument as pageOf, REPO, ROOT, WHERE } from "../../../test/helpers/board-document.ts";
import { renderBoardPage } from "./page.ts";
import { BOARD_CLIENT_JS } from "./client.ts";
import { BOARD_CSS } from "./styles.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

describe("the toolbar", () => {
	test("carries the page's state as chips, and the app's chrome last", () => {
		// One owner per fact: read-only and the stream's state are the header's chips, the way
		// browse wears them, and the reload control is the one action a dropped stream offers.
		const page = pageOf("board");
		expect(page).toContain('<div class="bf-app__facts">');
		expect(page).toContain('<span class="bf-live bf-tone--accent" id="board-status"');
		expect(page).toContain('<span class="bf-live__glyph" aria-hidden="true">◉</span>');
		expect(page).toContain('<span class="bf-live__text">connecting…</span>');
		expect(page).toContain('id="reload-hint"');
		// The app's chrome is its own zone, so `?` stops reading as one of the board's controls.
		expect(page).toContain(
			'<div class="bf-app__chrome"><button type="button" class="bf-btn bf-btn--icon" id="keys-open"',
		);
		// The chip is where a reader looks for the state, not a region that announces it.
		expect(page).not.toContain('aria-live="polite">connecting');
	});

	test("says which of the four states the stream is in, and offers the reload only once it is gone", () => {
		// The states and their transitions are the shared client's (`lib/web/live-stream.test.ts`);
		// this is the page's half of the contract, in the words the board says them in. A stream
		// that dropped is not yet a page that is wrong, so the control waits for `dead`.
		expect(BOARD_CLIENT_JS).toContain('else if (state === "reconnecting") text = "reconnecting');
		expect(BOARD_CLIENT_JS).toContain('else if (state === "dead") text = "offline"');
		expect(BOARD_CLIENT_JS).toContain('reload.hidden = state !== "dead"');
		// The age ticker repaints the state the stream is in: one that always said `live` flipped
		// an error back to a live chip within the second.
		expect(BOARD_CLIENT_JS).toContain("badge(streamState, board.lastFrame)");
		// One stream, opened by the client the kit hands every served page — and the token that
		// admits it handed over rather than spliced: a page that built its own query could drop
		// the one credential its mount checks, on the stream as on every other route.
		expect(BOARD_CLIENT_JS).toContain("board.liveStream({");
		expect(BOARD_CLIENT_JS).toContain("token: token,");
		// The URL this page opens is its own path and no query: the kit appends the token, so the
		// bundle's one `?token=` is the one the client wrote.
		expect(BOARD_CLIENT_JS).toContain('url: pageBase() + "/events",');
	});

	test("names the repository in the toolbar, and the root on its hover", () => {
		const page = pageOf("board");
		expect(page).toContain(
			`<span class="bf-context bf-context--subject" id="board-repo" title="${ROOT}">${REPO}</span>`,
		);
		// Both are server data, and a repository path can hold a quote: it is escaped, because
		// the root goes in an attribute.
		const odd = renderBoardPage({ view: "board", base: "", repo: "a&b", root: '/tmp/"x"', where: WHERE });
		expect(odd).toContain('title="/tmp/&quot;x&quot;"');
		expect(odd).toContain(">a&amp;b<");
	});
});

describe("the bar under it", () => {
	test("holds the board's own controls, in the order a reader uses them", () => {
		// The header answers who the board is of and whether it is live; the switch, the meter,
		// and the filter answer what the reader is looking at, so they get the row below it.
		const page = pageOf("board");
		const bar = page.slice(page.indexOf('<div class="bf-app__ctl board-bar">'));
		for (const id of ['id="tab-board"', 'id="tab-team"', 'id="board-progress"', 'id="board-filter"']) {
			expect(bar, id).toContain(id);
		}
		expect(bar.indexOf('id="board-filter"')).toBeGreaterThan(bar.indexOf('id="board-progress"'));
	});

	test("keeps the done meter at every width", () => {
		// It used to be the toolbar's, and a narrow window had no room for it beside the tabs,
		// the filter, and the chrome. In a row of its own it does, so the count is not a fact
		// that appears and disappears with the window.
		const media = BOARD_CSS.slice(BOARD_CSS.indexOf("@media (max-width:1180px)"));
		expect(media.slice(0, media.indexOf("@media (max-width:860px)"))).not.toContain("board-progress");
		expect(BOARD_CSS).toContain(".board-bar{gap:var(--space-3)}");
	});
});

describe("the footer", () => {
	test("calls a refused card file a file, as the tool does", () => {
		// `board list` says "N files this build cannot read", and this line said "cards" while its
		// own hover said files: one fact, one noun.
		expect(BOARD_CLIENT_JS).toContain('plural(view.skipped.length, "file")');
		expect(BOARD_CLIENT_JS).toContain('" could not be read"');
		expect(BOARD_CLIENT_JS).not.toContain('plural(view.skipped.length, "card")');
	});

	test("names the store before the first frame arrives", () => {
		// The store is the one footer fact the document can state, so a slow frame leaves a
		// line that names the board rather than an empty bar; the counts follow with the frame.
		const page = pageOf("board");
		expect(page).toContain('<footer class="bf-app__foot">');
		expect(page).toContain(`<span class="bf-footer__facts" id="board-where">store ${WHERE}</span>`);
	});
});

/** The board the stream case reads, and its browser. */
let board: BoardBrowser;

describe.skipIf(CHROME === undefined)("a dropped stream", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			display: { repo: REPO, root: ROOT, where: WHERE },
		});
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("offers the one action it leaves, and names the state", async () => {
		// A page whose server has gone is stale, not wrong: the chip says so in the danger tone
		// and the reload control appears beside it. Nothing is confirmed and nothing is written —
		// reloading is the only thing a reader can do here, so it is a control, not a dialog.
		const served = await serveBoardPage({
			store: board.store,
			now: clock.now,
			display: { repo: REPO, root: ROOT, where: WHERE },
		});
		const page = await board.tab(served.url);
		try {
			const chipText = () => page.textContent("#board-status");
			await page.waitForFunction(
				() =>
					(
						(
							globalThis as unknown as {
								document: { getElementById(id: string): { textContent: string | null } | null };
							}
						).document.getElementById("board-status")?.textContent ?? ""
					).includes("live"),
				undefined,
				{ timeout: PAINT_MS },
			);
			// A stream that is arriving offers no reload: the page it drew is still true.
			expect(await page.isVisible("#reload-hint")).toBe(false);
			expect(await page.getAttribute("#board-status", "class")).toContain("bf-tone--success");

			await served.close();
			// A stream that did not come back is where the page stops being true, so the chip ends
			// at `offline` in the danger tone and the reload appears beside it. The retry states
			// between the drop and this one are the shared client's, held in its own suite.
			await page.waitForSelector("#reload-hint:not([hidden])", { timeout: PAINT_MS });
			expect(await chipText()).toContain("offline");
			expect(await page.getAttribute("#board-status", "class")).toContain("bf-tone--danger");
			// The control names the action and keeps the remedy on its hover.
			expect((await page.textContent("#reload-hint"))?.trim()).toBe("⟳reload");
			expect(await page.getAttribute("#reload-hint", "title")).toBe("Run /board again if this does not clear");
		} finally {
			await page.close();
			await served.close();
		}
		// The stream is dead only after its retries, and each one waits out the server's own
		// `retry:` hint, so this case is a few seconds long by design rather than slow — inside
		// the run's own case budget.
	});
});
describe("the page's elevation", () => {
	test("lifts a card and its dialog through the kit's tokens, never a literal", () => {
		// A lane card is a plane now and the dialog floats above it: both name a kit token, so the two
		// depths cannot fork the way a hand-written blur would.
		expect(BOARD_CSS).toMatch(/\.bf-lane \.board-row\{[^}]*box-shadow:var\(--shadow-1\)/);
		expect(BOARD_CSS).toMatch(/\.board-dialog__panel\{[^}]*box-shadow:var\(--shadow-2\)/);
		for (const shadow of BOARD_CSS.matchAll(/box-shadow:([^;}]+)/g)) {
			if (shadow[1].startsWith("inset ")) continue;
			expect(shadow[1], shadow[1]).toMatch(/^var\(--shadow-[12]\)$/);
		}
	});
});

describe("the faint tier on a card", () => {
	test("clears AA on the darkest paper a card sits on, not just on the canvas", () => {
		// The kit's suite holds `--dim` to 4.5 against canvas, surface and raised; a board card is none of
		// those — its paper is the lane's tint over the surface — so the id, the kind and the count are
		// measured where they are read. Light's tint is almost white, which leaves the raised plane as
		// that theme's darkest, so both are checked.
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			const paper = over(tokens["--accent-soft"] as string, tokens["--surface"] as string);
			const faint = Math.min(
				contrast(tokens["--dim"] as string, paper),
				contrast(tokens["--dim"] as string, tokens["--raised"] as string),
				contrast(tokens["--dim"] as string, tokens["--canvas"] as string),
			);
			expect(faint, `${appearance} faint on a card`).toBeGreaterThanOrEqual(4.5);
		}
	});
});
