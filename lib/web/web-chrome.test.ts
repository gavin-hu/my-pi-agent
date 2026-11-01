/**
 * The served pages' chrome: the toolbar's zones, the subject, the live chip and its reload
 * control, the key-sheet button, the control bar, and the footer.
 *
 * Held apart from `web.test.ts` because that suite is at its size bar: a case that needs
 * room moves to a suite that has room, rather than the ledger's height being raised.
 */

import { describe, expect, test } from "bun:test";
import { WEB_BASE_CSS } from "./base.ts";
import { WEB_COMPONENTS_CSS } from "./components.ts";
import { SIDEBAR_COLLAPSE_MAX, WEB_LAYOUT_CSS } from "./layout.ts";
import { keysButton, liveChip, pageFooter, pageSubject, reloadChip, themeToggle, toolbarChrome } from "./markup.ts";
import { CLIENT_RUNTIME_JS, paintLive } from "./client-runtime.ts";

/** One rule's own body: the whole stylesheet has these properties somewhere, so scope first. */
function rule(css: string, selector: string): string {
	return css.slice(css.indexOf(selector)).split("}")[0] ?? "";
}

describe("the served page's chrome", () => {
	test("draws the toolbar's two zones, the live pill, and the footer's line", () => {
		for (const selector of [
			".bf-context--subject{",
			".bf-toolbar__facts{",
			".bf-toolbar__chrome{",
			".bf-toolbar__chrome .bf-btn{",
			".bf-toolbar__chrome .bf-btn:hover{",
			".bf-live{",
			".bf-live,.bf-reload{",
			".bf-live__glyph{",
			".bf-live__text{",
			".bf-reload{",
			".bf-reload:hover{",
			".bf-footer__facts{",
		]) {
			expect(WEB_COMPONENTS_CSS, selector).toContain(selector);
		}
	});

	test("gives a page's own controls a row between the header and the body", () => {
		// The toolbar answers who the page is of and how it is doing; a page's content
		// controls answer what it shows, so they do not crowd the identity out of the header.
		expect(WEB_LAYOUT_CSS).toContain(".bf-app__bar{display:flex;align-items:center;");
		expect(WEB_LAYOUT_CSS).toContain("flex:0 0 auto;flex-wrap:wrap;padding:var(--space-2) var(--space-6)");
		// Chrome is chrome on paper too: printing drops the bar with the toolbar.
		expect(WEB_BASE_CSS).toContain(".bf-toolbar,.bf-app__bar,.bf-app__sidebar,");
	});

	test("sends a long subject to a row of its own when the toolbar runs out", () => {
		// A served root can be deeper than the toolbar is wide: the subject takes the row
		// rather than squeezing the facts beside it into unreadable slivers.
		expect(WEB_LAYOUT_CSS).toContain(`@media (max-width:${SIDEBAR_COLLAPSE_MAX}px){`);
		expect(WEB_LAYOUT_CSS).toContain(".bf-toolbar .bf-context--subject{flex:1 1 100%}");
		// The subject is also the splitter, and the one label whose head is cut: cutting the
		// end kept only `Users/gavin/Repositories/Github/` and lost the folder being read.
		expect(WEB_COMPONENTS_CSS).toContain(".bf-context--subject{flex:1 1 auto;direction:rtl;text-align:left}");
		expect(WEB_COMPONENTS_CSS).not.toContain("direction:ltr");
	});

	test("wraps the footer's line rather than cutting a fact off it", () => {
		// A footer is one sentence carrying two facts. Truncating it hid one of them, and a cut
		// at the head left a stub of "served from" behind, which reads as damage rather than as
		// a fact; wrapping costs a line and keeps both.
		const facts = rule(WEB_COMPONENTS_CSS, ".bf-footer__facts{");
		expect(facts).toContain("overflow-wrap:anywhere");
		expect(facts).not.toContain("text-overflow");
		expect(facts).not.toContain("nowrap");
	});
});

describe("the chrome's atoms", () => {
	test("renders the page's subject as the toolbar's one truncating label", () => {
		const subject = pageSubject({ id: "board-repo", label: "my-pi-agent", title: '/tmp/"x"' });
		expect(subject).toContain('class="bf-context bf-context--subject"');
		expect(subject).toContain('id="board-repo"');
		// The whole path is the hover: the line keeps the tail, and the head is where two
		// clones of one repository differ.
		expect(subject).toContain('title="/tmp/&quot;x&quot;"');
		expect(pageSubject({ label: "a&b", title: "a&b" })).toContain(">a&amp;b<");
		expect(pageSubject({ label: "a", title: "a" })).not.toContain("id=");
	});

	test("renders the live chip with its state word, glyph, hooks, and start state", () => {
		const chip = liveChip({
			id: "live-state",
			label: "connecting",
			title: "Live status from the browse server",
			hidden: true,
			attrs: { "data-interval": "3000", "data-rev": 'a"b' },
		});
		expect(chip).toContain('class="bf-chip bf-chip--accent bf-live"');
		expect(chip).toContain('<span class="bf-live__glyph" aria-hidden="true">◉</span>');
		expect(chip).toContain('<span class="bf-live__text">connecting</span>');
		expect(chip).toContain('data-interval="3000"');
		expect(chip).toContain('data-rev="a&quot;b"');
		expect(chip).toContain(" hidden>");
		// Not a live region: the header is where a reader looks for the state, not a place to
		// announce every repaint of it.
		expect(chip).not.toContain("aria-live");
		expect(liveChip({ id: "x", label: "<b>" })).not.toContain(" hidden>");
		expect(liveChip({ id: "x", label: "<b>" })).toContain("&lt;b&gt;");
	});

	test("renders the reload control hidden, wearing the live chip's pill", () => {
		const reload = reloadChip({ title: "Run /board again if this does not clear" });
		expect(reload).toContain('class="bf-chip bf-chip--warn bf-reload"');
		expect(reload).toContain('id="reload-hint"');
		expect(reload).toContain('title="Run /board again if this does not clear"');
		expect(reload).toContain(" hidden>");
		expect(reload).toContain("⟳ reload");
	});

	test("renders the key-sheet trigger both pages open the sheet from", () => {
		// The sheet finds its trigger by id, so the two pages cannot name it differently.
		const trigger = keysButton();
		expect(trigger).toContain('id="keys-open"');
		expect(trigger).toContain("bf-btn--icon");
		expect(trigger).toContain('aria-haspopup="dialog"');
		expect(trigger).toContain(">?</button>");
	});

	test("puts the app's chrome in its own quiet zone, last in the toolbar", () => {
		const chrome = toolbarChrome();
		expect(chrome).toContain('<div class="bf-toolbar__chrome">');
		expect(chrome).toContain(keysButton());
		expect(chrome).toContain(themeToggle());
	});

	test("renders the footer as one line of the page's own facts", () => {
		const footer = pageFooter({ facts: "store ~/.pi/agent/board/x · <7> cards", factsId: "board-where" });
		expect(footer).toContain('<footer class="bf-app__footer">');
		expect(footer).toContain('<span class="bf-footer__facts" id="board-where">');
		expect(footer).toContain("store ~/.pi/agent/board/x · &lt;7&gt; cards");
		// A page whose client keeps the line true says so with an id; a page whose line is
		// server text needs none.
		expect(pageFooter({ facts: "served from /tmp" })).not.toContain("id=");
		expect(pageFooter({ facts: "served from /tmp" })).toContain("served from /tmp</span></footer>");
	});
});

describe("the live chip's painter", () => {
	/** The chip's word is a child, so the fake node answers the one selector. */
	function chipNode() {
		const text = { className: "", textContent: "connecting", title: "", hidden: false };
		const node = {
			className: "bf-chip bf-chip--accent bf-live",
			textContent: null as string | null,
			title: "Live status from the browse server",
			hidden: true,
			querySelector: (selector: string) => (selector === ".bf-live__text" ? text : null),
		};
		return { node, text };
	}

	test("paints the tone, the word, and the tooltip in place", () => {
		const { node, text } = chipNode();
		paintLive(node as unknown as Parameters<typeof paintLive>[0], "danger", "offline", "restart /browse");
		expect(node.className).toBe("bf-chip bf-live bf-chip--danger");
		expect(node.hidden).toBe(false);
		expect(node.title).toBe("restart /browse");
		expect(text.textContent).toBe("offline");
	});

	test("leaves a tooltip it was not given, so a page may keep a fixed one", () => {
		const { node, text } = chipNode();
		paintLive(node as unknown as Parameters<typeof paintLive>[0], "success", "live");
		expect(node.title).toBe("Live status from the browse server");
		expect(text.textContent).toBe("live");
		expect(node.className).toBe("bf-chip bf-live bf-chip--success");
	});

	test("carries one body, safe to splice, and answers the same once spliced", () => {
		// The bundle is a template literal: a backtick or an interpolation in the body would
		// end the script, and the failure would be a page that never paints.
		expect(CLIENT_RUNTIME_JS.split(String(paintLive)).length).toBe(2);
		expect(String(paintLive)).not.toContain("`");
		expect(String(paintLive)).not.toContain("${");
		const bundle = new Function(`${CLIENT_RUNTIME_JS}\nreturn { paintLive: paintLive };`)() as {
			paintLive: typeof paintLive;
		};
		const { node, text } = chipNode();
		bundle.paintLive(node as unknown as Parameters<typeof paintLive>[0], "warn", "stale");
		expect(node.className).toBe("bf-chip bf-live bf-chip--warn");
		expect(text.textContent).toBe("stale");
		// The chip answers one class per tone, and no tone is no modifier at all.
		bundle.paintLive(node as unknown as Parameters<typeof paintLive>[0], "", "connecting");
		expect(node.className).toBe("bf-chip bf-live");
	});
});
