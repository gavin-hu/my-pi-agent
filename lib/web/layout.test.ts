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
});
