/**
 * The Bytefly web brand system: theme tokens, base rules, components, layout,
 * HTML atoms, and the client runtime. Assertions hold the markup/selector
 * contract the pages and clients share.
 */

import { describe, expect, test } from "bun:test";
import { WEB_BASE_CSS } from "./base.ts";
import { WEB_COMPONENTS_CSS } from "./components.ts";
import { SIDEBAR_COLLAPSE_MAX, WEB_LAYOUT_CSS } from "./layout.ts";
import {
	brandLockup,
	button,
	chip,
	docHead,
	keysSheet,
	markIcon,
	TAB_TITLE_JS,
	tabTitle,
	themeToggle,
} from "./markup.ts";
import {
	dialogScript,
	keysDialogScript,
	THEME_JS,
	THEME_JS_PATH,
	THEME_TOGGLE_JS,
	WEB_THEME_STORAGE_KEY,
} from "./runtime.ts";
import { KEBAB, namesScript } from "./names.ts";
import { INLINE_MARKDOWN_JS } from "./markdown.ts";
import { CLIENT_RUNTIME_JS, el, paintStatus, postJson, typing } from "./client-runtime.ts";
import { WEB_THEME_CSS, WEB_THEME_TOKENS } from "./tokens.ts";

/** sRGB relative luminance of a `#rgb`/`#rrggbb` colour. */
function luminance(hex: string): number {
	const raw = hex.replace("#", "");
	const full =
		raw.length === 3
			? raw
					.split("")
					.map((character) => character + character)
					.join("")
			: raw;
	const channels = [0, 2, 4].map((offset) => {
		const value = Number.parseInt(full.slice(offset, offset + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two colours. */
function contrast(a: string, b: string): number {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (light + 0.05) / (dark + 0.05);
}

/** Every custom property the theme layer defines. */
const definedTokens = new Set([...WEB_THEME_CSS.matchAll(/--[a-z0-9-]+:/g)].map((match) => match[0].slice(0, -1)));

describe("web tokens", () => {
	test("anchors the palette to the Bytefly theme JSONs", () => {
		expect(WEB_THEME_TOKENS.dark["--canvas"]).toBe("#0d1117");
		expect(WEB_THEME_TOKENS.dark["--accent"]).toBe("#58a6ff");
		expect(WEB_THEME_TOKENS.light["--canvas"]).toBe("#ffffff");
		expect(WEB_THEME_TOKENS.light["--accent"]).toBe("#0969da");
	});

	test("every token resolves in both appearances", () => {
		for (const appearance of ["dark", "light"] as const) {
			for (const [token, value] of Object.entries(WEB_THEME_TOKENS[appearance])) {
				expect(value, `${appearance} ${token}`).toBeTruthy();
			}
		}
	});

	test("carries the shared syntax-token variables", () => {
		for (const token of ["comment", "keyword", "string", "number", "literal", "tag", "attr", "prop", "var"]) {
			expect(WEB_THEME_TOKENS.dark[`--tok-${token}`]).toBeTruthy();
			expect(WEB_THEME_TOKENS.light[`--tok-${token}`]).toBeTruthy();
		}
	});

	test("keeps body text at WCAG AA against both surfaces", () => {
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			for (const surface of ["--canvas", "--surface", "--raised"]) {
				expect(contrast(tokens["--text"], tokens[surface]), `${appearance} text/${surface}`).toBeGreaterThanOrEqual(
					4.5,
				);
				expect(contrast(tokens["--muted"], tokens[surface]), `${appearance} muted/${surface}`).toBeGreaterThanOrEqual(
					4.5,
				);
				expect(contrast(tokens["--accent"], tokens[surface]), `${appearance} accent/${surface}`).toBeGreaterThanOrEqual(
					4.5,
				);
			}
		}
	});

	test("derives a raised surface one visible step above the page's", () => {
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			// A block that must read as a plane needs more than the 1.09:1 a surface has
			// against the canvas, and less than the border it sits inside.
			expect(contrast(tokens["--raised"], tokens["--canvas"]), `${appearance} raised`).toBeGreaterThanOrEqual(1.1);
			expect(tokens["--raised"]).not.toBe(tokens["--surface"]);
		}
	});

	test("focuses a dialog's panel when the panel names itself focusable", () => {
		// The close button used to take the ring on every open, which put the eye in a
		// corner before it reached the content.
		expect(dialogScript({ dialogId: "x" })).toContain('[role="dialog"][tabindex]');
	});

	test("keeps status colours legible as UI", () => {
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			for (const token of ["--success", "--danger", "--warn"]) {
				expect(contrast(tokens[token], tokens["--canvas"]), `${appearance} ${token}`).toBeGreaterThanOrEqual(3);
			}
		}
	});

	test("keeps a label on the accent fill at AA", () => {
		// The primary button is the page's decisive action, so its label is the one
		// pairing that must clear 4.5 rather than 3.
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			expect(
				contrast(tokens["--on-accent"], tokens["--accent"]),
				`${appearance} on-accent/accent`,
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	test("keeps the dim role readable where it carries text", () => {
		// `--dim` is not decorative: it is the line-number gutter and the diff's
		// numbered column, so it has to stay above the large-text threshold.
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			for (const surface of ["--canvas", "--surface", "--raised"]) {
				expect(contrast(tokens["--dim"], tokens[surface]), `${appearance} dim/${surface}`).toBeGreaterThanOrEqual(3);
			}
		}
	});

	test("emits the dark base, the explicit light override, and the system fallback", () => {
		expect(WEB_THEME_CSS).toContain(":root{");
		expect(WEB_THEME_CSS).toContain(':root[data-theme="light"]');
		expect(WEB_THEME_CSS).toContain("prefers-color-scheme:light");
		expect(WEB_THEME_CSS).toContain("--canvas:#0d1117");
		expect(WEB_THEME_CSS).toContain("--canvas:#ffffff");
		expect(WEB_THEME_CSS).toContain(".tok-keyword{color:var(--tok-keyword)}");
	});

	test("prints the light palette last, so paper never takes the dark one", () => {
		// A dark page prints as grey text on a white sheet unless print resets the
		// tokens; being last in the sheet is what makes the reset win.
		const printAt = WEB_THEME_CSS.lastIndexOf("@media print{:root{");
		expect(printAt).toBeGreaterThan(WEB_THEME_CSS.lastIndexOf("@media (prefers-color-scheme:light)"));
		expect(WEB_THEME_CSS.slice(printAt)).toContain("--canvas:#ffffff");
		expect(WEB_THEME_CSS.slice(printAt)).toContain("color-scheme:light");
	});
});

describe("web base", () => {
	test("resets the body margin so the shell can fill the viewport", () => {
		expect(WEB_BASE_CSS).toContain("html,body{margin:0}");
	});

	test("normalises box sizing and hidden", () => {
		expect(WEB_BASE_CSS).toContain("*{box-sizing:border-box}");
		expect(WEB_BASE_CSS).toContain("[hidden]{display:none!important}");
	});

	test("styles links from tokens, never literals", () => {
		expect(WEB_BASE_CSS).toContain("a{color:var(--accent)");
	});

	test("gives every focusable element one ring", () => {
		expect(WEB_BASE_CSS).toContain("outline:var(--focus-ring) solid var(--accent)");
		expect(WEB_BASE_CSS).toContain(":focus-visible");
	});

	test("carries the skip link and screen-reader helper", () => {
		expect(WEB_BASE_CSS).toContain(".skip{");
		expect(WEB_BASE_CSS).toContain(".skip:focus{");
		expect(WEB_BASE_CSS).toContain(".sr-only{");
	});

	test("prints the document without its chrome", () => {
		expect(WEB_BASE_CSS).toContain("@media print{");
		expect(WEB_BASE_CSS).toContain(
			".bf-toolbar,.bf-app__sidebar,.bf-app__footer,.bf-progress,.skip,.bf-dialog{display:none!important}",
		);
		expect(WEB_BASE_CSS).toContain("overflow:visible!important}");
	});

	test("keeps the drawn controls legible in forced colours", () => {
		expect(WEB_BASE_CSS).toContain("@media (forced-colors:active){");
		expect(WEB_BASE_CSS).toContain(".bf-md .md-check:checked{forced-color-adjust:none;background:Highlight");
		expect(WEB_BASE_CSS).toContain("outline-color:CanvasText");
	});
});

describe("web components", () => {
	test("covers the shell primitives and their variants", () => {
		for (const selector of [
			".bf-brand{",
			".bf-mark__top{",
			".bf-btn{",
			".bf-btn--danger{",
			".bf-btn--primary{",
			".bf-btn--ghost{",
			".bf-btn--icon{",
			".bf-chip--outline{",
			".bf-chip--warn{",
			".bf-segmented{",
			".bf-segmented__item{",
			".bf-field{",
			".bf-panel{",
			".bf-progress__fill{",
			".bf-status--saved{",
			".bf-empty__code{",
			".bf-dialog__panel{",
			".bf-keys{",
			".bf-kbd{",
		]) {
			expect(WEB_COMPONENTS_CSS).toContain(selector);
		}
	});

	test("covers the content components", () => {
		for (const selector of [
			".bf-tree__row{",
			".bf-tree__tw--toggle::after{",
			".bf-crumbs{",
			".bf-table{",
			".bf-sort{",
			".bf-card__head{",
			".bf-code__line{",
			".bf-code--numbered .bf-code__line::before{",
			".bf-media{",
			".bf-md{",
			".bf-comment{",
			".bf-composer{",
		]) {
			expect(WEB_COMPONENTS_CSS).toContain(selector);
		}
	});

	test("lets Markdown fill its panel", () => {
		expect(WEB_COMPONENTS_CSS).toContain(".bf-md{min-width:0;min-height:0;");
		expect(WEB_COMPONENTS_CSS).not.toContain("max-width:80ch");
	});

	test("styles the Markdown extras the renderer emits", () => {
		for (const selector of [
			".bf-md li.task{",
			".bf-md .md-check{",
			".bf-md table{",
			".bf-md .md-table-frame{",
			".bf-md .md-table-wrap{",
			".bf-md th,.bf-md td{",
			".bf-md thead th{",
			".bf-md .md-left{",
			".bf-md .md-center{",
			".bf-md .md-right{",
			".bf-md img{",
			".bf-md hr{",
			".bf-md details{",
			".bf-md summary{",
			".bf-md figure{",
			".bf-md figcaption{",
			".bf-md kbd{",
			".bf-md mark{",
			".bf-md abbr[title]{",
			".bf-md sub,.bf-md sup{",
		]) {
			expect(WEB_COMPONENTS_CSS).toContain(selector);
		}
		// Columns size to their content and the wrapper scrolls a wide table
		// horizontally, rather than a fixed layout equalizing and wrapping it.
		expect(WEB_COMPONENTS_CSS).toContain(
			".bf-md table{margin:0;border-collapse:collapse;table-layout:auto;width:auto;",
		);
		expect(WEB_COMPONENTS_CSS).toContain(".bf-md .md-table-frame{position:relative}");
		expect(WEB_COMPONENTS_CSS).toContain(".bf-md .md-table-wrap{overflow-x:auto;");
	});

	test("draws the task checkbox so a done item can be green", () => {
		// A disabled native checkbox is UA gray in both themes, so the success
		// colour only reaches it once the box is drawn with appearance:none.
		expect(WEB_COMPONENTS_CSS).toContain(".bf-md .md-check{appearance:none;");
		expect(WEB_COMPONENTS_CSS).toContain(".bf-md .md-check:checked{border-color:var(--success);");
		expect(WEB_COMPONENTS_CSS).toContain(".bf-md .md-check:disabled{opacity:1}");
	});

	test("keeps Markdown table cells out of the prose word breaking", () => {
		// `.bf-md` sets `overflow-wrap:anywhere`, which also shrinks a cell's
		// min-content width, so auto layout starves a code-span column and
		// `feature-detail` breaks mid-word into two code chips. Cells wrap only
		// when a word cannot fit, headers and code spans stay on one line, and a
		// genuinely wide table overflows into the scrolling wrapper instead.
		expect(WEB_COMPONENTS_CSS).toContain(
			".bf-md th,.bf-md td{border:1px solid var(--border);padding:6px 10px;text-align:left;vertical-align:top;overflow-wrap:break-word}",
		);
		expect(WEB_COMPONENTS_CSS).toContain(".bf-md th{white-space:nowrap}");
		expect(WEB_COMPONENTS_CSS).toContain(".bf-md th code,.bf-md td code{white-space:nowrap}");
	});

	test("uses only defined custom properties", () => {
		const used = new Set([...WEB_COMPONENTS_CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]));
		for (const token of used) {
			expect(definedTokens.has(token), `undefined token ${token}`).toBe(true);
		}
	});

	test("keeps the Bytefly palette out of the component literals", () => {
		for (const hex of ["#0d1117", "#58a6ff", "#d29922", "#3fb950", "#f85149"]) {
			expect(WEB_COMPONENTS_CSS).not.toContain(hex);
		}
	});

	test("draws every colour through a token", () => {
		// The kit is the one place a theme swap never reaches, so a literal here is a
		// colour that survives the toggle. Overlays are tokens too (`--scrim`,
		// `--shadow`); the only encoded colour is the checkbox's `%23fff` data URI.
		expect(WEB_COMPONENTS_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		expect(WEB_COMPONENTS_CSS).not.toContain("rgba(");
	});
});

describe("web layout", () => {
	test("defines the app shell regions", () => {
		for (const selector of [
			".bf-app{",
			".bf-app__header{",
			".bf-app__body{",
			".bf-app__sidebar{",
			".bf-app__main{",
			".bf-app__footer{",
		]) {
			expect(WEB_LAYOUT_CSS).toContain(selector);
		}
	});

	test("collapses the sidebar to one column on narrow screens", () => {
		expect(WEB_LAYOUT_CSS).toContain(`@media (max-width:${SIDEBAR_COLLAPSE_MAX}px)`);
		expect(WEB_LAYOUT_CSS).toContain(".bf-app__body{flex:none;grid-template-columns:1fr}");
		expect(WEB_LAYOUT_CSS).toContain(".bf-app__sidebar .bf-panel__summary{");
	});

	test("fills the viewport so the panes scroll inside the shell", () => {
		// A definite height is what bounds the panes; min-height alone lets the
		// document scroll instead, which breaks the sticky headers and the panes.
		expect(WEB_LAYOUT_CSS).toContain(
			".bf-app{display:flex;flex-direction:column;height:100vh;min-height:0;overflow:hidden;",
		);
		// The fallback first, then the unit that follows a phone's visible viewport.
		expect(WEB_LAYOUT_CSS).toContain(".bf-app{height:100dvh}");
	});

	test("scrolls the sidebar on its own box", () => {
		// A `<details>` gives its content a block wrapper with no definite height,
		// so a `.bf-panel` inside cannot shrink to the sidebar and scroll itself;
		// the sidebar has to be the scroll container.
		expect(WEB_LAYOUT_CSS).toContain("overflow-x:hidden;overflow-y:auto;background:var(--surface)");
	});

	test("returns to normal page scroll on narrow screens", () => {
		expect(WEB_LAYOUT_CSS).toContain(".bf-app{height:auto;min-height:100vh;overflow:visible}");
		expect(WEB_LAYOUT_CSS).toContain("max-height:none;overflow:visible;border-right:0");
	});
});

describe("web names", () => {
	const table = { card: "board-card", laneHead: "board-lane__head" } as const;

	test("serializes a table as a script statement a bundle can start with", () => {
		expect(namesScript(table)).toBe('var N = {"card":"board-card","laneHead":"board-lane__head"};');
		// The value is spliced into a template literal: a backtick would end the string
		// and `${` would interpolate at build time, so both are refused at the boundary.
		expect(namesScript(table)).not.toContain("`");
		expect(namesScript(table)).not.toContain("${");
		expect(namesScript(table, "CLASSES")).toBe('var CLASSES = {"card":"board-card","laneHead":"board-lane__head"};');
	});

	test("refuses a name that is not a class name, naming it", () => {
		for (const bad of ["board card", "card`", "${x}", "Board-Card", "", "-lead"]) {
			expect(() => namesScript({ card: bad }), bad).toThrow(/is not a kebab-case name/);
			expect(KEBAB.test(bad), bad).toBe(false);
		}
		expect(() => namesScript(table, "not ok")).toThrow(/is not a name a script can declare/);
	});

	test("accepts the shapes a stylesheet can select", () => {
		for (const good of ["card", "board-card", "board-card__head", "board-card--done", "x1"]) {
			expect(KEBAB.test(good), good).toBe(true);
		}
	});
});

/** The decoded SVG of every icon link in one markup string. */
function iconSvgs(markup: string): string[] {
	return [...markup.matchAll(/href="data:image\/svg\+xml,([^"]*)"/g)].map((match) =>
		decodeURIComponent(match[1] ?? ""),
	);
}

describe("web markup", () => {
	test("renders the shared document head", () => {
		const head = docHead({ title: "browse · <dir>", css: "body{}" });
		expect(head).toContain('<meta charset="utf-8">');
		expect(head).toContain('name="color-scheme"');
		expect(head).toContain("<style>body{}</style>");
		expect(head).toContain(`src="${THEME_JS_PATH}"`);
		expect(head).toContain("&lt;dir&gt;");
	});

	test("links the brand mark as the tab icon, in the appearance the tab is in", () => {
		const head = docHead({ title: "browse", css: "body{}" });
		// Two links, not one: an icon is its own document and cannot read the page's tokens,
		// so the appearance is chosen by the link rather than by a stylesheet.
		const links = head.split("\n").filter((line) => line.startsWith('<link rel="icon"'));
		expect(links).toHaveLength(2);
		expect(links[0]).not.toContain("media=");
		expect(links[1]).toContain('media="(prefers-color-scheme: light)"');
		for (const line of links) {
			// `data:` only, and one href per link: the page's CSP is `img-src 'self' data:`, so an
			// icon fetched from anywhere else would be a tab with no mark at all.
			expect(line.match(/href="/g)).toHaveLength(1);
			expect(line).toContain('href="data:image/svg+xml,');
		}
		expect(iconSvgs(head)).toHaveLength(2);
	});

	test("draws the tab icon from the same blocks as the lockup", () => {
		const icon = markIcon();
		// The shape is written once: a second copy is a mark that drifts the first time it is
		// redrawn, and the lockup and the tab would stop being the same mark.
		const rects = (svg: string) => svg.match(/<rect [^>]*\/>/g)?.join("");
		const lockup = brandLockup("board");
		for (const svg of iconSvgs(icon)) {
			expect(svg).toContain('viewBox="0 0 4 2"');
			expect(rects(svg)).toBe(rects(lockup));
		}
	});

	test("paints each icon with its own appearance's accent and warning", () => {
		const [dark = "", light = ""] = iconSvgs(markIcon());
		expect(dark).toContain(WEB_THEME_TOKENS.dark["--accent"]);
		expect(dark).toContain(WEB_THEME_TOKENS.dark["--warn"]);
		expect(light).toContain(WEB_THEME_TOKENS.light["--accent"]);
		expect(light).toContain(WEB_THEME_TOKENS.light["--warn"]);
		expect(dark).not.toBe(light);
	});

	test("shapes a tab title as page, subject, count, and leaves out what a page lacks", () => {
		// One convention for the three served pages: the page's own name, lowercase and the
		// same word its lockup carries, then what it shows, then the count a reader opens the
		// tab for.
		expect(tabTitle("board", "my-pi-agent", "3 open")).toBe("board · my-pi-agent · 3 open");
		expect(tabTitle("board", "my-pi-agent")).toBe("board · my-pi-agent");
		expect(tabTitle("plan review", "Add rate limiting")).toBe("plan review · Add rate limiting");
		expect(tabTitle("browse", "src/billing")).toBe("browse · src/billing");
		// An empty part is not a part: a board that has nothing open is not "board · ".
		expect(tabTitle("board")).toBe("board");
		expect(tabTitle("board", "", "")).toBe("board");
	});

	test("hands the tab title's body to the bundle, safe to splice into a script", () => {
		// The board's count is live, so the page's script must build the same string. A
		// backtick or an interpolation here would end the template the source lands in.
		expect(TAB_TITLE_JS).toBe(String(tabTitle));
		expect(TAB_TITLE_JS).not.toContain("`");
		expect(TAB_TITLE_JS).not.toContain("${");
	});

	test("answers what the module answers once it is a script", () => {
		const browser = new Function(`return (${TAB_TITLE_JS});`)() as (
			product: string,
			subject?: string,
			count?: string,
		) => string;
		expect(browser("board", "my-pi-agent", "3 open")).toBe(tabTitle("board", "my-pi-agent", "3 open"));
		expect(browser("plan review", "Add rate limiting")).toBe(tabTitle("plan review", "Add rate limiting"));
		expect(browser("board")).toBe(tabTitle("board"));
	});

	test("serves the pre-paint theme from the one path the head asks for", () => {
		// The routers route this constant, so a page cannot point at a script no
		// route serves — which is what the literal in both routers allowed.
		expect(THEME_JS_PATH).toBe("/theme.js");
	});

	test("builds the brand lockup from the two-tone mark", () => {
		const brand = brandLockup("<plan>");
		expect(brand).toContain('class="bf-mark"');
		expect(brand).toContain("bf-mark__top");
		expect(brand).toContain("bf-wordmark");
		expect(brand).toContain("bytefly");
		expect(brand).toContain("&lt;plan&gt;");
	});

	test("keeps the theme-toggle element contract", () => {
		const toggle = themeToggle();
		expect(toggle).toContain('id="theme-toggle"');
		expect(toggle).toContain('class="theme-glyph"');
		expect(toggle).toContain("bf-btn--icon");
	});

	test("escapes chip labels and applies the tone", () => {
		const rendered = chip({ label: "a<b", tone: "warn" });
		expect(rendered).toContain("bf-chip--warn");
		expect(rendered).toContain("a&lt;b");
	});

	test("renders a chip glyph as trusted markup", () => {
		const rendered = chip({ label: "ok", icon: "<svg></svg>" });
		expect(rendered).toContain("<svg></svg>");
	});

	test("escapes button labels and carries modifier attributes", () => {
		const rendered = button({ label: "Go", variant: "primary", pressed: true, attrs: { "data-x": "1" } });
		expect(rendered).toContain("bf-btn--primary");
		expect(rendered).toContain('aria-pressed="true"');
		expect(rendered).toContain('data-x="1"');
	});

	test("renders the shortcut sheet with one kbd per key", () => {
		const sheet = keysSheet([
			{ keys: "/ \u2318K", label: "Quick open" },
			{ keys: ["j", "k"], label: "Move <block> & comment" },
		]);
		expect(sheet).toContain('id="keys-dialog" hidden');
		expect(sheet).toContain('id="keys-close"');
		expect(sheet).toContain('<dl class="bf-keys">');
		expect(sheet).toContain('<kbd class="bf-kbd">/ \u2318K</kbd>');
		expect(sheet).toContain('<kbd class="bf-kbd">j</kbd> <kbd class="bf-kbd">k</kbd>');
		expect(sheet).toContain("Move &lt;block&gt; &amp; comment");
	});

	test("puts a note under the sheet, escaped like every other label", () => {
		// A rule that is not a key — what an open dialog keeps — belongs under the table, not
		// in a row of its own with a key nobody presses.
		const sheet = keysSheet([{ keys: "?", label: "this sheet" }], "A dialog keeps <t> for itself");
		expect(sheet).toContain('<p class="bf-keys__note">A dialog keeps &lt;t&gt; for itself</p>');
		expect(keysSheet([{ keys: "?", label: "this sheet" }])).not.toContain("bf-keys__note");
	});
});

describe("web theme runtime", () => {
	test("shares one storage key across the bootstrap and the toggle", () => {
		expect(THEME_JS).toContain(WEB_THEME_STORAGE_KEY);
		expect(THEME_TOGGLE_JS).toContain(WEB_THEME_STORAGE_KEY);
	});

	test("applies a saved theme before paint", () => {
		expect(THEME_JS).toContain("data-theme");
		expect(() => new Function(THEME_JS)).not.toThrow();
	});

	test("wires the toggle to the shared element contract", () => {
		expect(THEME_TOGGLE_JS).toContain('getElementById("theme-toggle")');
		expect(THEME_TOGGLE_JS).toContain(".theme-glyph");
		expect(THEME_TOGGLE_JS).toContain("prefers-color-scheme: light");
		expect(THEME_TOGGLE_JS).toContain("data-theme");
		expect(() => new Function(THEME_TOGGLE_JS)).not.toThrow();
	});

	test("wires the shortcut sheet to the shared element contract", () => {
		const script = keysDialogScript("keys-open");
		expect(script).toContain('getElementById("keys-dialog")');
		expect(script).toContain('getElementById("keys-close")');
		expect(script).toContain('getElementById("keys-open")');
		expect(script).toContain("window.bfKeys");
		expect(() => new Function(script)).not.toThrow();
	});

	test("each page opens the same sheet from its own trigger", () => {
		// The sheet's ids are fixed; only the shortcut button differs per page.
		expect(keysDialogScript("shortcuts")).toContain('getElementById("shortcuts")');
		expect(keysDialogScript("shortcuts")).not.toContain('getElementById("keys-open")');
	});

	test("traps Tab, closes on Esc, and restores focus for any dialog", () => {
		const script = dialogScript({ dialogId: "approve-dialog", closeId: "approve-cancel", globalName: "bfApprove" });
		expect(script).toContain('getElementById("approve-dialog")');
		expect(script).toContain('getElementById("approve-cancel")');
		expect(script).toContain("window.bfApprove");
		expect(script).toContain('if (event.key !== "Tab") return;');
		// Every Tab is redirected, not only the two that wrap: the panel is the container of
		// the rest, so a browser's own backwards step from the last node leaves the dialog.
		expect(script).toContain("nodes.indexOf(document.activeElement)");
		expect(script).toContain("nodes[next].focus();");
		expect(script).toContain("opener.focus()");
		expect(script).toContain("}, true);");
		expect(script).toContain("event.stopPropagation();");
		expect(() => new Function(script)).not.toThrow();
	});
});

describe("web client runtime", () => {
	test("carries each body once, and the string is safe to splice", () => {
		// The bundle is a template literal: a backtick or an interpolation in one of these
		// bodies would end the script, and the failure would be a page that never paints.
		expect(CLIENT_RUNTIME_JS).not.toContain("`");
		expect(CLIENT_RUNTIME_JS).not.toContain("${");
		for (const fn of [el, typing, paintStatus, postJson]) {
			expect(CLIENT_RUNTIME_JS.split(String(fn)).length, String(fn).slice(0, 40)).toBe(2);
		}
	});

	test("a spliced bundle builds and answers the same as the module", () => {
		const made: Array<{ tag: string; className: string; textContent: string | null }> = [];
		const fakeHtml = {
			createElement(tag: string) {
				const node = { tag, className: "", textContent: null as string | null, title: "" };
				made.push(node);
				return node;
			},
		};
		const bundle = new Function(
			"globalThis",
			"fetch",
			`${CLIENT_RUNTIME_JS}\nreturn { el: el, typing: typing, paintStatus: paintStatus, postJson: postJson };`,
		) as (
			g: unknown,
			f: unknown,
		) => {
			el: typeof el;
			typing: typeof typing;
			paintStatus: typeof paintStatus;
			postJson: typeof postJson;
		};
		const runtime = bundle({ document: fakeHtml }, async () => ({}));

		const node = runtime.el("span", "bf-chip", "billing-core");
		expect(node.textContent).toBe("billing-core");
		expect(made[0]?.className).toBe("bf-chip");
		expect(runtime.el("p").textContent).toBeNull();

		expect(runtime.typing({ tagName: "INPUT" })).toBe(true);
		expect(runtime.typing({ tagName: "textarea" })).toBe(true);
		expect(runtime.typing({ tagName: "div", isContentEditable: true })).toBe(true);
		expect(runtime.typing({ tagName: "body" })).toBe(false);
		expect(runtime.typing({})).toBe(false);

		runtime.paintStatus(node, "live \u00B7 3m", "saved");
		expect(node.className).toBe("bf-status bf-status--saved");
		expect(node.title).toBe("live \u00B7 3m");
		runtime.paintStatus(node, "");
		expect(node.className).toBe("bf-status");
		expect(node.textContent).toBe("");
	});

	test("reads the reply body on both branches, so a refusal keeps its reason", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fakeFetch = async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return {
				ok: false,
				status: 409,
				json: async () => ({ error: "the plan changed on disk" }),
			};
		};
		const global = { document: { createElement: () => ({ className: "", textContent: null, title: "" }) } };
		const runtime = new Function("globalThis", "fetch", `${CLIENT_RUNTIME_JS}\nreturn { postJson: postJson };`)(
			global,
			fakeFetch,
		) as { postJson: typeof postJson };
		const before = globalThis.fetch;
		Object.assign(globalThis, { fetch: fakeFetch });
		try {
			const result = await runtime.postJson("/api/feedback?token=t", { annotations: [] });
			expect(result).toEqual({ ok: false, status: 409, body: { error: "the plan changed on disk" } });
		} finally {
			Object.assign(globalThis, { fetch: before });
		}
		expect(calls[0]?.init.method).toBe("POST");
		expect(calls[0]?.init.headers).toEqual({ "Content-Type": "application/json" });
		expect(calls[0]?.init.body).toBe('{"annotations":[]}');
	});

	test("a body that is not JSON costs the reason, not the answer", async () => {
		const fakeFetch = async () => ({
			ok: true,
			status: 200,
			json: async () => {
				throw new Error("not json");
			},
		});
		const before = globalThis.fetch;
		Object.assign(globalThis, { fetch: fakeFetch });
		try {
			expect(await postJson("/api/x", {})).toEqual({ ok: true, status: 200, body: null });
		} finally {
			Object.assign(globalThis, { fetch: before });
		}
	});
});

describe("web markdown", () => {
	/** One node the renderer made: an element, or a text node when the tag is `#text`. */
	class FakeNode {
		children: FakeNode[] = [];
		href = "";
		target = "";
		rel = "";
		textContent: string | null = null;
		constructor(
			readonly tag: string,
			readonly className = "",
		) {}
		appendChild(child: FakeNode): void {
			this.children.push(child);
		}
	}

	/** What the fragment appends for one piece of inline Markdown. */
	function render(text: string): FakeNode {
		const container = new FakeNode("#root");
		const document = {
			createElement: (tag: string) => new FakeNode(tag),
			createTextNode: (value: string) => Object.assign(new FakeNode("#text"), { textContent: value }),
		};
		const location = { href: "http://127.0.0.1:7000/board?token=t" };
		const run = new Function(
			"el",
			"document",
			"location",
			`${INLINE_MARKDOWN_JS}\nreturn { safeHref: safeHref, renderInline: renderInline };`,
		) as (
			el: (tag: string, className?: string) => FakeNode,
			doc: unknown,
			loc: unknown,
		) => {
			safeHref: (url: string, base: string) => string | null;
			renderInline: (into: FakeNode, text: string) => void;
		};
		const parsed = run((tag, className) => new FakeNode(tag, className), document, location);
		parsed.renderInline(container, text);
		return container;
	}

	/** The tag of each child, in the order the renderer appended it. */
	function tags(node: FakeNode): string[] {
		return node.children.map((child) => child.tag);
	}

	test("crosses as source, and appends text nodes and four atoms only", () => {
		// The bundle is a template literal, so a backtick or an interpolation would end the
		// script; and the point of the renderer is that it never assembles markup.
		expect(INLINE_MARKDOWN_JS).not.toContain("`");
		expect(INLINE_MARKDOWN_JS).not.toContain("${");
		expect(INLINE_MARKDOWN_JS).not.toContain("innerHTML");
		expect(INLINE_MARKDOWN_JS).not.toContain("<code");
		expect(INLINE_MARKDOWN_JS).toContain("function renderInline(");
		expect(INLINE_MARKDOWN_JS).toContain("function safeHref(");

		const made = render("`retry` **twice** *soon* [docs](https://example.com/x)");
		expect(tags(made)).toEqual(["code", "#text", "strong", "#text", "em", "#text", "a"]);
		expect(made.children[0]?.textContent).toBe("retry");
		expect(made.children[2]?.textContent).toBe("twice");
		expect(made.children[4]?.textContent).toBe("soon");
		const link = made.children[6];
		expect(link?.textContent).toBe("docs");
		expect(link?.href).toBe("https://example.com/x");
		expect(link?.target).toBe("_blank");
		expect(link?.rel).toBe("noreferrer noopener");
	});

	test("keeps a target it cannot vouch for as text, not as a link", () => {
		// The URL parser strips a tab or a newline, so a target that only looks relative is
		// cross-origin once parsed: it must stay text, like every scheme but three.
		for (const target of [
			"javascript:alert(1)",
			"data:text/html,hi",
			"//evil.example/x",
			"https://user:pass@example.com/",
			"/\t/evil.example",
		]) {
			const source = `[x](${target})`;
			const made = render(source);
			// A refused target is text, whole: an unbalanced parenthesis in one only splits the
			// run of text nodes, and joining it back is what the reader sees.
			expect(
				tags(made).filter((tag) => tag === "a"),
				target,
			).toEqual([]);
			expect(made.children.map((child) => child.textContent).join(""), target).toBe(source);
		}
	});

	test("resolves a same-origin target and leaves markup as text", () => {
		// A page's own paths are the one relative target it may hand a source at: the note
		// and the plan both get a working link to the page they are read on.
		const relative = render("[files](/files?p=docs)");
		expect(tags(relative)).toEqual(["a"]);
		expect(relative.children[0]?.href).toBe("http://127.0.0.1:7000/files?p=docs");

		// `renderInline` never parses: an HTML tag a person typed is a sentence about one.
		const markup = render("<b>hi</b> and <script>x</script>");
		expect(tags(markup)).toEqual(["#text"]);
		expect(markup.children[0]?.textContent).toBe("<b>hi</b> and <script>x</script>");
	});
});
