import { describe, expect, test } from "bun:test";
import { brandLockup, button, chip, docHead, themeToggle } from "./markup.ts";

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

	test("escapes button labels and carries modifier attributes", () => {
		const rendered = button({ label: "Go", variant: "primary", pressed: true, attrs: { "data-x": "1" } });
		expect(rendered).toContain("bf-btn--primary");
		expect(rendered).toContain('aria-pressed="true"');
		expect(rendered).toContain('data-x="1"');
	});
});
