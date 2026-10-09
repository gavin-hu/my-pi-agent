import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { oneLine } from "./transcript.ts";

describe("oneLine", () => {
	test("collapses control characters and whitespace to one line", () => {
		const out = oneLine("line1\u001b[31m\nline2\t\tend\u0007");
		expect(out).toBe("line1 [31m line2 end");
		expect(out).not.toContain("\u001b");
		expect(out).not.toContain("\u0007");
	});

	test("clips to a display width with an ellipsis", () => {
		const out = oneLine("x".repeat(200), 20);
		expect(visibleWidth(out)).toBeLessThanOrEqual(20);
		expect(out.endsWith("…")).toBe(true);
	});

	test("leaves clean text alone", () => {
		expect(oneLine("Pi — a coding agent")).toBe("Pi — a coding agent");
	});
});
