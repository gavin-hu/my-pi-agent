/**
 * The chrome the shell holds: the live line and its reload control, the key sheet's trigger,
 * the footer, and the grammar the kit speaks — a rail tag, a marker-free switch, a bracketed key,
 * a prompt line, a gauge of fixed cells — plus the painter that keeps the live word true.
 *
 * The shell's own rows, gutter and media answers live in `shell.test.ts`: this suite reached the
 * 400-line bar, and the shell is the half the next work extends, so the seam sits there.
 */

import { describe, expect, test } from "bun:test";
import { WEB_COMPONENTS_CSS } from "./components.ts";
import { WEB_LAYOUT_CSS } from "./layout.ts";
import { appHead, chip, keysButton, liveChip, pageFooter, reloadChip, themeToggle } from "./markup.ts";
import { CLIENT_RUNTIME_JS, paintLive } from "./client-runtime.ts";
import { rule } from "../../test/helpers/web-classes.ts";

describe("the chrome's atoms", () => {
	test("draws the mark's own two-tone rule, out of the flow of the identity row", () => {
		const brand = appHead({ product: "board", subject: { label: "a", title: "a" }, facts: "" });
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
		const chrome = appHead({ product: "board", subject: { label: "a", title: "a" }, facts: "" });
		expect(chrome).toContain('<div class="bf-app__chrome">');
		expect(chrome).toContain(keysButton());
		expect(chrome).toContain(themeToggle());
		// Borderless at rest, and on all four edges: the hover rule brings back the colour alone.
		expect(rule(WEB_LAYOUT_CSS, ".bf-app__chrome .bf-btn{")).toBe(
			".bf-app__chrome .bf-btn{border-width:1px;border-color:transparent;color:var(--muted)",
		);
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
	test("keeps the pill, the key cap and one tone set, and lifts only through a shadow token", () => {
		// One tone set replaces a class per chip colour; elevation is a token, and a literal blur in
		// a component is the fork this holds.
		expect(WEB_COMPONENTS_CSS).not.toContain("--radius-pill");
		expect(WEB_COMPONENTS_CSS).not.toContain("999px");
		expect(WEB_COMPONENTS_CSS).toMatch(/box-shadow:var\(--shadow-[12]\)/);
		// Every shadow in the sheet names a token, never a colour and a blur.
		for (const shadow of WEB_COMPONENTS_CSS.matchAll(/box-shadow:([^;}]+)/g)) {
			expect(shadow[1], shadow[1]).toMatch(/^var\(--shadow-[12]\)$/);
		}
		expect(WEB_COMPONENTS_CSS).not.toContain(".bf-chip");
		expect(WEB_COMPONENTS_CSS).not.toContain(".bf-segmented");
		expect(WEB_COMPONENTS_CSS).not.toContain(".bf-progress");
		// The one rounded shape left: a count badge, at the badge radius.
		expect(rule(WEB_COMPONENTS_CSS, ".bf-badge{")).toContain("border-radius:var(--radius-badge)");
	});

	test("draws a tag as a glyph and a word, with no rail and no box around them", () => {
		const tag = rule(WEB_COMPONENTS_CSS, ".bf-tag{");
		expect(tag).not.toMatch(/border-left|padding-left/);
		// A tag's word is a label, so it is the UI's face: mono is kept for a path or a command.
		expect(tag).toContain("var(--font-ui)");
		expect(tag).not.toContain("var(--font-mono)");
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

	test("draws the record as a flat sheet, named by its head", () => {
		// A record is a tint and a hairline on the page's own plane: nothing floats under it, so it
		// takes no elevation. The head names the record; a stripe above it would read as a state.
		expect(rule(WEB_COMPONENTS_CSS, ".bf-record{")).toContain("border:1px solid var(--border)");
		expect(rule(WEB_COMPONENTS_CSS, ".bf-record{")).not.toContain("box-shadow");
		expect(WEB_COMPONENTS_CSS).not.toContain(".bf-record::before");
		// A comment's label is a glyph in the dim role: warn is the verdict it carries, not the
		// colour of the label itself.
		expect(WEB_COMPONENTS_CSS).toContain(
			".bf-comment__label{font:var(--fw-medium) var(--fs-xs) var(--font-ui);color:var(--dim)}",
		);
	});

	test("draws a lane as a head with a tone rule and rows under it", () => {
		// No tray, no fill, no inset edge: the lane's tone is in the rule it already draws, and a
		// row is a list item until a reader points at it.
		expect(WEB_COMPONENTS_CSS).toContain(".bf-lane__head{display:flex;align-items:center;gap:6px;");
		expect(WEB_COMPONENTS_CSS).toContain(
			"border-bottom:2px solid var(--lane-role,var(--border));font:var(--fw-semibold) var(--fs-sm)",
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
		// A heading's weight step is its section mark: the rail glyph is gone, and the face is the UI's.
		expect(WEB_COMPONENTS_CSS).not.toContain('::before{content:"▏"');
		expect(WEB_COMPONENTS_CSS).toContain(".bf-md h1,.bf-md h2,.bf-md h3,.bf-md h4,.bf-md h5,.bf-md h6{");
		expect(rule(WEB_COMPONENTS_CSS, ".bf-md h1,.bf-md h2,.bf-md h3,.bf-md h4,.bf-md h5,.bf-md h6{")).toContain(
			"var(--font-ui)",
		);
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
