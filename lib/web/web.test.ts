/**
 * The Bytefly web brand system: theme tokens, base rules, components, layout,
 * HTML atoms, and the client runtime. Assertions hold the markup/selector
 * contract the pages and clients share.
 */

import { describe, expect, test } from "bun:test";
import { WEB_BASE_CSS } from "./base.ts";
import { WEB_COMPONENTS_CSS } from "./components.ts";
import { SIDEBAR_COLLAPSE_MAX, WEB_LAYOUT_CSS } from "./layout.ts";
import { brandLockup, button, chip, docHead, keysSheet, themeToggle } from "./markup.ts";
import { keysDialogScript, THEME_JS, THEME_TOGGLE_JS, WEB_THEME_STORAGE_KEY } from "./runtime.ts";
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
			for (const surface of ["--canvas", "--surface"]) {
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

	test("keeps status colours legible as UI", () => {
		for (const appearance of ["dark", "light"] as const) {
			const tokens = WEB_THEME_TOKENS[appearance];
			for (const token of ["--success", "--danger", "--warn"]) {
				expect(contrast(tokens[token], tokens["--canvas"]), `${appearance} ${token}`).toBeGreaterThanOrEqual(3);
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
});

describe("web components", () => {
	test("covers the shell primitives and their variants", () => {
		for (const selector of [
			".bf-brand{",
			".bf-mark__top{",
			".bf-btn{",
			".bf-btn--primary{",
			".bf-btn--ghost{",
			".bf-btn--icon{",
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

describe("web markup", () => {
	test("renders the shared document head", () => {
		const head = docHead({ title: "browse · <dir>", css: "body{}" });
		expect(head).toContain('<meta charset="utf-8">');
		expect(head).toContain('name="color-scheme"');
		expect(head).toContain("<style>body{}</style>");
		expect(head).toContain('src="/theme.js"');
		expect(head).toContain("&lt;dir&gt;");
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
});
