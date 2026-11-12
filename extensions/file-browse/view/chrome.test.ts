/**
 * The browse pages' chrome: the subject, the live chip and its reload, the footer's line.
 *
 * Held apart from `view/pages.test.ts`, which is at its size bar: that suite owns what the
 * pages *contain*, and this one owns the shell around the content and the script that keeps
 * its state true. The fixtures both read are in `test/helpers/file-browse-view.ts`.
 */

import { describe, expect, test } from "bun:test";
import { NARROW_MAX_PX, paintLive } from "../../../lib/web/index.ts";
import { kitNamesIn, rulesClass, sourcesUnder } from "../../../test/helpers/web-classes.ts";
import { CLIENT_JS } from "./client.ts";
import { directoryPage } from "../../../test/helpers/file-browse-view.ts";
import { LIVE_CLIENT_JS } from "./live-client.ts";
import { BROWSE_CSS } from "./styles.ts";

describe("the header", () => {
	test("keeps the served folder's tail when the path is cut", () => {
		// A left ellipsis names the root; cutting the end kept only
		// `Users/gavin/Repositories/Github/` and lost the folder being browsed. The rule is the
		// kit's now, and this page wears it with the path itself.
		expect(directoryPage()).toContain('<span class="bf-context bf-context--subject"');
		expect(BROWSE_CSS).not.toContain("browse-root");
		expect(BROWSE_CSS).not.toContain("direction:ltr");
	});

	test("renders the live chrome only when the channel is on", () => {
		const live = directoryPage({ live: { intervalMs: 3000 } });
		expect(live).toContain('id="live-state"');
		expect(live).toContain('data-interval="3000"');
		// The chip is the kit's, and the server's accounting of the stream is its hover.
		expect(live).toContain('class="bf-live bf-tone--accent" id="live-state"');
		expect(live).toContain('<span class="bf-live__text">connecting</span>');
		expect(live).toContain('id="reload-hint"');
		expect(live).toContain('id="browse-changes" href="/diff"');

		const off = directoryPage();
		expect(off).not.toContain("live-state");
		expect(off).not.toContain("reload-hint");
		// The footer carries the page's facts and nothing the header already owns.
		expect(off).toContain('<footer class="bf-app__foot"><span class="bf-footer__facts">served from ');
		expect(off).not.toContain("read-only · ");
	});
});

describe("the wrap control", () => {
	test("means no wrap on a narrow screen, where the page wraps by default", () => {
		// The kit wraps a code panel below a phone's width, so "off" has to be a class of its
		// own: dropping a class would leave the lines wrapped and the button doing nothing.
		expect(CLIENT_JS).toContain('code.classList.toggle("bf-code--wrap", on)');
		expect(CLIENT_JS).toContain('code.classList.toggle("bf-code--nowrap", !on)');
		// With no choice stored, the button starts on the answer the page is already showing.
		expect(CLIENT_JS).toContain('saved === null ? narrowWindow() : saved === "1"');
		// The width is the kit's number, not a second copy of it: the media rule that wraps the
		// panel and this query must move together, or the button describes a rule that changed.
		expect(CLIENT_JS).toContain(`matchMedia("(max-width:${NARROW_MAX_PX}px)")`);
	});
});

describe("the live script", () => {
	test("paints the chip through the kit, and offers the reload when the stream goes", () => {
		// One painter, written once: the tone is a modifier and the state's word is the chip's
		// child, so a page never builds the shape. The states are the shared client's; what this
		// page adds is the words, and the hover that names the way back once they are spent.
		expect(CLIENT_JS).toContain(String(paintLive));
		expect(LIVE_CLIENT_JS).toContain("paintLive(liveChip, tone, word, liveTitle(word))");
		expect(LIVE_CLIENT_JS).toContain(
			'if (word === "offline") return "The server stopped — restart /browse, then reload"',
		);
		// A stream that dropped is stale, not dead: the chip says so while the browser retries.
		expect(LIVE_CLIENT_JS).toContain('paintLiveState("reconnecting", "warn", "reconnecting")');
		expect(LIVE_CLIENT_JS).toContain("liveServer =");
		expect(LIVE_CLIENT_JS).toContain("showLiveReload();");
		// The page's own copy of the pill, and of its word, are gone: a second shape is how the
		// two pages drift apart again.
		expect(CLIENT_JS).not.toContain('"bf-chip browse-live"');
		expect(CLIENT_JS).not.toContain("browse-live__text");
	});

	test("names no token, and leaves the stream's close to the kit", () => {
		// This page mints none — it answers on the loopback socket only — so it says so rather
		// than leaving the reader to guess; and the teardown is the shared client's, so its own
		// `pagehide` has only its timers left to clear.
		expect(LIVE_CLIENT_JS).toContain("token: undefined");
		expect(LIVE_CLIENT_JS).not.toContain("?token=");
		expect(LIVE_CLIENT_JS).toContain('addEventListener("pagehide"');
		expect(LIVE_CLIENT_JS).not.toContain(".close()");
	});
});

describe("the kit's names", () => {
	test("every kit class the pages write is one the CSS they ship still rules", () => {
		// ef01313c deleted the .bf-card family and .bf-chip and renamed .bf-segmented to .bf-tabs,
		// and all of those names stayed in the markup and the scripts: the head, both mode controls
		// and the header chips drew with no rule at all while every suite stayed green. The kit's
		// own suite holds the inward half (it still names no removed class); this is the outward
		// half, read from the text rather than from imports because the failure is a string no
		// type checker sees.
		// `bf-diff-line` is a family, not a class: each line wears a colour modifier and the sheet rules
		// all five, so the exact name is never the one a reader sees.
		const families = new Set(["bf-diff-line"]);
		expect(
			kitNamesIn(sourcesUnder(import.meta.dir, ["styles.ts"])).filter(
				(name) => !families.has(name) && !rulesClass(BROWSE_CSS, name),
			),
		).toEqual([]);
	});
});
