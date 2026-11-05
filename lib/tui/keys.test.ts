/**
 * The two keys a surface tells apart: the screen's close and the turn's interrupt.
 *
 * Both are decoded here rather than in the screen that binds them, because a
 * surface that ends something longer-lived than itself — the plan review ends a
 * turn — has to say which key means which. Escape and Ctrl+C close a screen
 * whose state is all on it; Ctrl+C alone is the interrupt.
 */

import { describe, expect, test } from "bun:test";
import { isCloseKey, isInterruptKey } from "./cursor.ts";

describe("isCloseKey", () => {
	test("matches Escape and Ctrl+C only", () => {
		expect(isCloseKey("\x1b")).toBe(true);
		expect(isCloseKey("\x03")).toBe(true);
		expect(isCloseKey("q")).toBe(false);
		expect(isCloseKey("\r")).toBe(false);
	});
});

describe("isInterruptKey", () => {
	test("matches Ctrl+C and not Escape, which the close key already carries", () => {
		expect(isInterruptKey("\x03")).toBe(true);
		expect(isInterruptKey("\x1b")).toBe(false);
		expect(isInterruptKey("q")).toBe(false);
	});
});
