import { describe, expect, test } from "bun:test";
import { qrLines, qrMatrix } from "./qrcode.ts";

describe("qrLines", () => {
	test("returns equal-width lines sized to the matrix plus the quiet zone", () => {
		const lines = qrLines("hello", { quiet: 2 });
		const width = qrMatrix("hello").size + 4;
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) expect(line.length).toBe(width);
	});

	test("uses only half-block and space characters", () => {
		for (const line of qrLines("https://example.com/login")) {
			expect(/^[█▀▄ ]*$/.test(line)).toBe(true);
		}
	});

	test("produces the same output for the same text", () => {
		expect(qrLines("stable")).toEqual(qrLines("stable"));
	});
});
