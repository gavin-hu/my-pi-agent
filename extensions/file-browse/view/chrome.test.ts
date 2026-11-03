/**
 * The browse pages' chrome: the subject, the live chip and its reload, the footer's line.
 *
 * Held apart from `view/pages.test.ts`, which is at its size bar: that suite owns what the
 * pages *contain*, and this one owns the shell around the content and the script that keeps
 * its state true. The fixtures both read are in `test/helpers/file-browse-view.ts`.
 */

import { describe, expect, test } from "bun:test";
import { paintLive } from "../../../lib/web/index.ts";
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
		expect(live).toContain('class="bf-chip bf-chip--accent bf-live" id="live-state"');
		expect(live).toContain('<span class="bf-live__text">connecting</span>');
		expect(live).toContain('id="reload-hint"');
		expect(live).toContain('id="browse-changes" href="/diff"');

		const off = directoryPage();
		expect(off).not.toContain("live-state");
		expect(off).not.toContain("reload-hint");
		// The footer carries the page's facts and nothing the header already owns.
		expect(off).toContain('<footer class="bf-app__footer"><span class="bf-footer__facts">served from ');
		expect(off).not.toContain("read-only · ");
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
});
