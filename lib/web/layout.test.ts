import { describe, expect, test } from "bun:test";
import { WEB_LAYOUT_CSS } from "./layout.ts";

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
		expect(WEB_LAYOUT_CSS).toContain("@media (max-width:860px)");
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
