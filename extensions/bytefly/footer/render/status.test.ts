import { describe, expect, test } from "bun:test";
import { GLYPHS } from "../../../../lib/tui/glyphs.ts";
import { compactStatus, dropStatusDetail } from "./status.ts";

describe("compactStatus", () => {
	test("keeps only the icon of an icon+label status", () => {
		expect(compactStatus(`${GLYPHS.plan} plan`)).toBe(GLYPHS.plan);
	});

	test("keeps the count of an icon+count badge", () => {
		expect(compactStatus("↺ 2")).toBe("↺2");
		expect(compactStatus("▸ 12")).toBe("▸12");
	});

	test("preserves color while compacting", () => {
		expect(compactStatus("\x1b[33m↺ 3\x1b[39m")).toBe("\x1b[33m↺3\x1b[39m");
	});

	test("strips a CSI or OSC sequence, not just SGR", () => {
		expect(compactStatus("ab\x1b[2J")).toBe("ab");
		expect(compactStatus("a\x1b]0;title\x07b")).toBe("ab");
	});

	test("does not mistake a numeric label for a count", () => {
		expect(compactStatus(`${GLYPHS.plan} plan · 2024`)).toBe(GLYPHS.plan);
	});
});

describe("dropStatusDetail", () => {
	test("removes a trailing detail but keeps leading styling", () => {
		expect(dropStatusDetail(`${GLYPHS.plan} plan · add-rate-limiting`)).toBe(`${GLYPHS.plan} plan`);
		expect(dropStatusDetail(`\x1b[33m${GLYPHS.plan} plan · add-rate-limiting\x1b[39m`)).toBe(
			`\x1b[33m${GLYPHS.plan} plan\x1b[39m`,
		);
	});

	test("leaves a status without detail untouched", () => {
		expect(dropStatusDetail(`${GLYPHS.plan} plan`)).toBe(`${GLYPHS.plan} plan`);
		expect(dropStatusDetail("↺ 2")).toBe("↺ 2");
	});
});
