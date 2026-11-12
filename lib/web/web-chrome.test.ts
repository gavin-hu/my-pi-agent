/**
 * The served pages' chrome: the shell's two header rows and its one gutter, the live line and
 * its reload control, the key sheet's trigger, the footer, and the grammar the kit now speaks —
 * a rail tag, a marker-free switch, a bracketed key, a prompt line, and a gauge of fixed cells.
 *
 * Held apart from `web.test.ts` because that suite is at its size bar: a case that needs room
 * moves to a suite that has room, rather than the ledger's height being raised.
 */

import { describe, expect, test } from "bun:test";
import { WEB_BASE_CSS } from "./base.ts";
import { WEB_COMPONENTS_CSS } from "./components.ts";
import { SIDEBAR_COLLAPSE_MAX, WEB_LAYOUT_CSS } from "./layout.ts";
import {
	brandLockup,
	chip,
	keysButton,
	liveChip,
	pageFooter,
	pageSubject,
	reloadChip,
	themeToggle,
	toolbarChrome,
} from "./markup.ts";
import { CLIENT_RUNTIME_JS, paintLive } from "./client-runtime.ts";

/** One rule's own body: the whole stylesheet has these properties somewhere, so scope first. */
function rule(css: string, selector: string): string {
	return css.slice(css.indexOf(selector)).split("}")[0] ?? "";
}

describe("the shell's two rows", () => {
	test("draws identity over controls, with a plain rule between and under them", () => {
		for (const selector of [".bf-app__id{", ".bf-app__rule{", ".bf-app__ctl{", ".bf-app__foot{"]) {
			expect(WEB_LAYOUT_CSS, selector).toContain(selector);
		}
		// A separator is a hairline in the border role, never a coloured segment: the signature
		// rule has two homes — the mark and a record — and a header separator is neither.
		expect(rule(WEB_LAYOUT_CSS, ".bf-app__rule{")).toBe(".bf-app__rule{height:1px;background:var(--border)");
		expect(rule(WEB_LAYOUT_CSS, ".bf-app__head{")).toContain("border-bottom:1px solid var(--border)");
		expect(WEB_LAYOUT_CSS).not.toContain("linear-gradient");
		// The old bar retired: a page's own controls are the header's second row, not a third
		// strip between the header and the content.
		expect(WEB_LAYOUT_CSS).not.toContain(".bf-app__bar");
		expect(WEB_BASE_CSS).toContain(
			".bf-app__head,.bf-app__sidebar,.bf-app__foot,.bf-gauge,.skip,.bf-dialog{display:none!important}",
		);
	});

	test("draws the header's zones and the live line's parts", () => {
		for (const selector of [".bf-app__facts{", ".bf-app__chrome{", ".bf-app__chrome .bf-btn:hover{"]) {
			expect(WEB_LAYOUT_CSS, selector).toContain(selector);
		}
		for (const selector of [
			".bf-live{",
			".bf-live__glyph{",
			".bf-live__text{",
			".bf-reload{",
			".bf-reload:hover{",
			".bf-footer__facts{",
		]) {
			expect(WEB_COMPONENTS_CSS, selector).toContain(selector);
		}
	});

	test("takes the control row's height from its padding and its rhythm from three groups", () => {
		// 12 inside a role, 24 between roles: the switch, the meter and the prompt line are
		// three groups, so the gap carries the first step and the group's margin the second.
		expect(WEB_LAYOUT_CSS).toContain(
			".bf-app__ctl{display:flex;align-items:baseline;gap:var(--space-3);flex-wrap:wrap;padding:5px var(--space-6)}",
		);
		expect(WEB_LAYOUT_CSS).toContain(".bf-app__group{display:flex;align-items:baseline;gap:var(--space-3)");
		expect(WEB_LAYOUT_CSS).toContain(".bf-app__group+.bf-app__group{margin-left:var(--space-3)}");
	});

	test("runs every row of the shell on one gutter, at the viewport's width", () => {
		// The mark, the lane heads, the prompt's right edge and the footer are meant to land on
		// the same two verticals, so one rule pads all four and nothing centres a column.
		expect(WEB_LAYOUT_CSS).toContain("@media (min-width:1440px){");
		expect(WEB_LAYOUT_CSS).toContain(
			".bf-app__id,.bf-app__ctl,.bf-app__main,.bf-app__foot{padding-left:var(--space-7);padding-right:var(--space-7)}",
		);
		for (const selector of [".bf-app__id{", ".bf-app__ctl{", ".bf-app__main{", ".bf-app__foot{"]) {
			expect(rule(WEB_LAYOUT_CSS, selector), selector).toContain("var(--space-6)");
			expect(rule(WEB_LAYOUT_CSS, selector), selector).not.toContain("max-width");
		}
		expect(WEB_LAYOUT_CSS).not.toContain("margin:0 auto");
	});

	test("sends a long subject to a row of its own when the identity row runs out", () => {
		// A served root can be deeper than the identity row is wide: the subject takes the row
		// rather than squeezing the facts beside it into unreadable slivers.
		expect(WEB_LAYOUT_CSS).toContain(`@media (max-width:${SIDEBAR_COLLAPSE_MAX}px){`);
		expect(WEB_LAYOUT_CSS).toContain(".bf-app__id .bf-context--subject{flex:1 1 100%}");
		// The subject is also the splitter, and the one label whose head is cut: cutting the
		// end kept only `Users/gavin/Repositories/Github/` and lost the folder being read.
		expect(WEB_COMPONENTS_CSS).toContain(".bf-context--subject{flex:1 1 auto;direction:rtl;text-align:left");
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
	test("renders the page's subject as the identity row's one truncating label", () => {
		const subject = pageSubject({ id: "board-repo", label: "my-pi-agent", title: '/tmp/"x"' });
		expect(subject).toContain('class="bf-context bf-context--subject"');
		expect(subject).toContain('id="board-repo"');
		// The whole path is the hover: the line keeps the tail, and the head is where two
		// clones of one repository differ.
		expect(subject).toContain('title="/tmp/&quot;x&quot;"');
		expect(pageSubject({ label: "a&b", title: "a&b" })).toContain(">a&amp;b<");
		expect(pageSubject({ label: "a", title: "a" })).not.toContain("id=");
	});

	test("draws the mark's own two-tone rule, out of the flow of the identity row", () => {
		const brand = brandLockup("board");
		expect(brand).toContain('<span class="bf-brand__rule" aria-hidden="true"></span>');
		// Out of flow, or a wrapped header stretches the rule beside the path instead of
		// leaving it under the mark.
		const mark = rule(WEB_COMPONENTS_CSS, ".bf-brand__rule{");
		expect(mark).toContain("position:absolute");
		expect(mark).toContain("width:18px;height:2px");
		expect(mark).toContain("var(--accent)");
		expect(mark).toContain("var(--warn)");
	});

	test("renders the live line with its state word, glyph, hooks, and start state", () => {
		const live = liveChip({
			id: "live-state",
			label: "connecting",
			title: "Live status from the browse server",
			hidden: true,
			attrs: { "data-interval": "3000", "data-rev": 'a"b' },
		});
		expect(live).toContain('class="bf-live bf-tone--accent"');
		expect(live).toContain('<span class="bf-live__glyph" aria-hidden="true">◉</span>');
		expect(live).toContain('<span class="bf-live__text">connecting</span>');
		expect(live).toContain('data-interval="3000"');
		expect(live).toContain('data-rev="a&quot;b"');
		expect(live).toContain(" hidden>");
		// Not a live region: the header is where a reader looks for the state, not a place to
		// announce every repaint of it.
		expect(live).not.toContain("aria-live");
		expect(liveChip({ id: "x", label: "<b>" })).not.toContain(" hidden>");
		expect(liveChip({ id: "x", label: "<b>" })).toContain("&lt;b&gt;");
	});

	test("renders the reload control hidden, borderless, in the warn tone", () => {
		const reload = reloadChip({ title: "Run /board again if this does not clear" });
		expect(reload).toContain('class="bf-reload bf-tone--warn"');
		expect(reload).toContain('id="reload-hint"');
		expect(reload).toContain('title="Run /board again if this does not clear"');
		expect(reload).toContain(" hidden>");
		// The glyph is decoration and the word is the label, so a screen reader says `reload`.
		expect(reload).toContain('<span aria-hidden="true">⟳</span>reload');
		// The live state and its one action are the same shape: the tone is the text's colour
		// and neither draws a box, so a new state never costs a new rule.
		expect(rule(WEB_COMPONENTS_CSS, ".bf-live,.bf-reload{")).not.toContain("border:1px solid");
	});

	test("renders the key-sheet trigger both pages open the sheet from", () => {
		// The sheet finds its trigger by id, so the two pages cannot name it differently.
		const trigger = keysButton();
		expect(trigger).toContain('id="keys-open"');
		expect(trigger).toContain("bf-btn--icon");
		expect(trigger).toContain('aria-haspopup="dialog"');
		expect(trigger).toContain(">?</button>");
	});

	test("puts the app's chrome in its own quiet zone, last in the identity row", () => {
		const chrome = toolbarChrome();
		expect(chrome).toContain('<div class="bf-app__chrome">');
		expect(chrome).toContain(keysButton());
		expect(chrome).toContain(themeToggle());
		// Borderless at rest, so the key sheet cannot read as one of the page's own controls.
		expect(rule(WEB_LAYOUT_CSS, ".bf-app__chrome .bf-btn{")).toContain("border-color:transparent");
	});

	test("renders the footer as one line of where the page came from", () => {
		const footer = pageFooter({ facts: "store ~/.pi/agent/board/x · <7> cards", factsId: "board-where" });
		expect(footer).toContain('<footer class="bf-app__foot">');
		expect(footer).toContain('<span class="bf-footer__facts" id="board-where">');
		expect(footer).toContain("store ~/.pi/agent/board/x · &lt;7&gt; cards");
		// A page whose client keeps the line true says so with an id; a page whose line is
		// server text needs none.
		expect(pageFooter({ facts: "served from /tmp" })).not.toContain("id=");
		expect(pageFooter({ facts: "served from /tmp" })).toContain("served from /tmp</span></footer>");
		// Provenance only: the live state and the keys live in a header that never scrolls away,
		// so a footer that repeated them would be a second place for a fact already on screen.
		expect(footer).not.toContain("bf-live");
		expect(footer).not.toContain("bf-kbd");
		expect(footer).not.toContain("reload-hint");
	});
});

describe("the live line's painter", () => {
	/** The line's word is a child, so the fake node answers the one selector. */
	function chipNode() {
		const text = { className: "", textContent: "connecting", title: "", hidden: false };
		const node = {
			className: "bf-live bf-tone--accent",
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
		expect(node.className).toBe("bf-live bf-tone--danger");
		expect(node.hidden).toBe(false);
		expect(node.title).toBe("restart /browse");
		expect(text.textContent).toBe("offline");
	});

	test("leaves a tooltip it was not given, so a page may keep a fixed one", () => {
		const { node, text } = chipNode();
		paintLive(node as unknown as Parameters<typeof paintLive>[0], "success", "live");
		expect(node.title).toBe("Live status from the browse server");
		expect(text.textContent).toBe("live");
		expect(node.className).toBe("bf-live bf-tone--success");
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
		expect(node.className).toBe("bf-live bf-tone--warn");
		expect(text.textContent).toBe("stale");
		// The line answers one modifier set per tone, and no tone is no modifier at all.
		bundle.paintLive(node as unknown as Parameters<typeof paintLive>[0], "", "connecting");
		expect(node.className).toBe("bf-live");
	});
});

describe("the kit's grammar", () => {
	test("keeps the pill, the key cap, the shadow, and the six-chip tone set out of the kit", () => {
		// The shapes are the breaking half of the change: one tone set replaces a class per chip
		// colour, and a box casts no shadow because a rail and a hairline hold every panel.
		expect(WEB_COMPONENTS_CSS).not.toContain("--radius-pill");
		expect(WEB_COMPONENTS_CSS).not.toContain("999px");
		expect(WEB_COMPONENTS_CSS).not.toContain("box-shadow");
		expect(WEB_COMPONENTS_CSS).not.toContain("--shadow");
		expect(WEB_COMPONENTS_CSS).not.toContain(".bf-chip");
		expect(WEB_COMPONENTS_CSS).not.toContain(".bf-segmented");
		expect(WEB_COMPONENTS_CSS).not.toContain(".bf-progress");
		// The one rounded shape left: a count badge, at the badge radius.
		expect(rule(WEB_COMPONENTS_CSS, ".bf-badge{")).toContain("border-radius:var(--radius-badge)");
	});

	test("draws a tag as a glyph and a word on a rail, with no box around them", () => {
		const tag = rule(WEB_COMPONENTS_CSS, ".bf-tag{");
		expect(tag).toContain("border-left:2px solid currentColor");
		expect(tag).toContain("var(--font-mono)");
		expect(tag).not.toContain("border-radius");
		expect(tag).not.toContain("border:1px solid");
		expect(WEB_COMPONENTS_CSS).toContain(".bf-tag__glyph{");
		expect(WEB_COMPONENTS_CSS).toContain(".bf-tag--trunc{");
		// The markup half: a tone is one modifier and the glyph is decoration.
		const rendered = chip({ label: "read-only", tone: "warn", icon: "⊘" });
		expect(rendered).toContain('class="bf-tag bf-tone--warn"');
		expect(rendered).toContain('<span class="bf-tag__glyph" aria-hidden="true">⊘</span>');
		expect(rendered).toContain("read-only");
	});

	test("keeps one tone set for every state the kit draws", () => {
		for (const tone of ["accent", "success", "warn", "danger", "dim", "muted"]) {
			expect(WEB_COMPONENTS_CSS, tone).toContain(`.bf-tone--${tone}{color:var(--`);
		}
		// A tone is the text's colour: a state that also drew its own border would be the
		// second shape the modifier set exists to remove.
		for (const tone of ["accent", "success", "warn", "danger", "dim", "muted"]) {
			expect(rule(WEB_COMPONENTS_CSS, `.bf-tone--${tone}{`), tone).not.toContain("border");
		}
	});

	test("opens the field with a prompt line whose rule arrives on hover or focus", () => {
		// At rest the filter is text; the rule is the affordance, so it cannot be a permanent
		// box around a control that has none.
		expect(rule(WEB_COMPONENTS_CSS, ".bf-field{")).toContain("border-bottom:1px solid transparent");
		expect(rule(WEB_COMPONENTS_CSS, ".bf-field:hover{")).toContain("border-bottom-color:var(--border)");
		expect(rule(WEB_COMPONENTS_CSS, ".bf-field:focus-within{")).toContain("border-bottom-color:var(--accent)");
		expect(WEB_COMPONENTS_CSS).toContain('.bf-field__prompt::before{content:"❯"}');
	});

	test("draws tabs with no box, no underline, and no marker", () => {
		const tabs = rule(WEB_COMPONENTS_CSS, ".bf-tabs{");
		expect(tabs).not.toContain("border");
		expect(tabs).not.toContain("background");
		const item = rule(WEB_COMPONENTS_CSS, ".bf-tabs__item{");
		expect(item).toContain("border:0");
		expect(item).toContain("background:none");
		expect(item).toContain("color:var(--muted)");
		// The weight is the non-colour cue that keeps the current view off hue alone.
		expect(WEB_COMPONENTS_CSS).toContain(
			'.bf-tabs__item[aria-current],.bf-tabs__item[aria-selected="true"],.bf-tabs__item[aria-pressed="true"]{color:var(--accent);font-weight:var(--fw-semibold)}',
		);
		expect(WEB_COMPONENTS_CSS).toContain(".bf-tabs__item+.bf-tabs__item{border-left:1px solid var(--border)}");
		expect(WEB_COMPONENTS_CSS).toContain(".bf-tabs__count{");
	});

	test("holds the record in a box under the signature rule, and no shadow", () => {
		// The signature terminates rather than decorates: the accent's 12px lead, the warn's 6px
		// step, then the same hairline the box is drawn with.
		expect(rule(WEB_COMPONENTS_CSS, ".bf-record{")).toContain("border:1px solid var(--border)");
		expect(rule(WEB_COMPONENTS_CSS, ".bf-record::before{")).toContain(
			"var(--accent) 0 12px,var(--warn) 12px 18px,var(--border) 18px",
		);
		// A comment's label is a glyph in the dim role: warn is the verdict it carries, not the
		// colour of the label itself.
		expect(WEB_COMPONENTS_CSS).toContain(
			".bf-comment__label{font:var(--fw-medium) var(--fs-xs) var(--font-mono);color:var(--dim)}",
		);
	});

	test("draws a lane as a head with a tone rule and rows under it", () => {
		// No tray, no fill, no inset edge: the lane's tone is in the rule it already draws, and a
		// row is a list item until a reader points at it.
		expect(WEB_COMPONENTS_CSS).toContain(".bf-lane__head{display:flex;align-items:center;gap:6px;");
		expect(WEB_COMPONENTS_CSS).toContain(
			"border-bottom:2px solid var(--lane-role,var(--border));font:var(--fw-semibold) var(--fs-xs)",
		);
		expect(WEB_COMPONENTS_CSS).toContain(
			".bf-lane__dot{font-size:9px;line-height:1;color:var(--lane-role,var(--muted))}",
		);
		expect(WEB_COMPONENTS_CSS).toContain(
			".bf-row__mark{font:var(--fs-xs) var(--font-mono);line-height:1.6;color:var(--lane-role,var(--dim))}",
		);
		expect(rule(WEB_COMPONENTS_CSS, ".bf-row:hover,.bf-row:focus-visible{")).toContain("background:var(--surface)");
		expect(WEB_COMPONENTS_CSS).toContain('.bf-row[data-current="true"] .bf-row__title{font-weight:var(--fw-semibold)}');
		expect(WEB_COMPONENTS_CSS).toContain(
			'.bf-section[data-tone="warn"] .bf-section__cap{border-bottom-color:var(--warn)}',
		);
	});

	test("draws the gauge as fixed cells in the terminal's two roles", () => {
		// Ten cells and a literal count: the bar is decoration and the number is the fact.
		expect(rule(WEB_COMPONENTS_CSS, ".bf-gauge{")).toContain("white-space:nowrap");
		expect(rule(WEB_COMPONENTS_CSS, ".bf-gauge__cells{")).toContain("color:var(--success)");
		expect(rule(WEB_COMPONENTS_CSS, ".bf-gauge__empty{")).toContain("color:var(--border)");
		expect(rule(WEB_COMPONENTS_CSS, ".bf-gauge__text{")).toContain("tabular-nums");
		// The six-pixel track and its fill carried the quantity in a width a reader had to
		// estimate; nothing writes a width now.
		expect(WEB_COMPONENTS_CSS).not.toContain(".bf-progress__fill");
		expect(WEB_COMPONENTS_CSS).not.toContain("width:72px;height:6px");
	});

	test("brackets a key rather than drawing a key cap", () => {
		expect(WEB_COMPONENTS_CSS).toContain('.bf-kbd::before{content:"[";color:var(--dim)}');
		expect(WEB_COMPONENTS_CSS).toContain('.bf-kbd::after{content:"]";color:var(--dim)}');
		const kbd = rule(WEB_COMPONENTS_CSS, ".bf-kbd{");
		expect(kbd).not.toContain("border");
		expect(kbd).not.toContain("background");
	});

	test("de-GitHubs the Markdown block", () => {
		// No underline under a heading: the rule under one was GitHub's, and a heading that
		// carries a rail reads as a section without a second line across the page.
		expect(WEB_COMPONENTS_CSS).toContain('.bf-md h2::before{content:"▏";color:var(--dim)');
		expect(WEB_COMPONENTS_CSS).not.toContain(".bf-md h1,.bf-md h2{padding-bottom");
		// Rule-only rows and an unfilled head, not a full cell grid with a grey band.
		expect(WEB_COMPONENTS_CSS).toContain(".bf-md thead th{border-bottom:2px solid var(--border)");
		expect(WEB_COMPONENTS_CSS).not.toContain(".bf-md thead th{background:var(--surface)");
		// Flush code with one rail, and the one measure the kit owns.
		expect(WEB_COMPONENTS_CSS).toContain(".bf-md pre{border:0;border-left:2px solid var(--border)");
		expect(WEB_COMPONENTS_CSS).not.toContain(".bf-md pre{border:1px solid var(--border)");
		expect(WEB_COMPONENTS_CSS).toContain("max-width:var(--measure-prose)");
	});
});
