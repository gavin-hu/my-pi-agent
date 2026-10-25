/**
 * The card body the tool and the page both read.
 *
 * The refusals are asserted by their sentence, because that sentence is what a caller
 * shows — the tool as a failed result, the page as a 422 — and because the order they
 * come in is the order a person fixes them.
 */

import { describe, expect, test } from "bun:test";
import { MAX_TITLE } from "../../lib/board/card.ts";
import { createInput } from "./input.ts";

describe("createInput", () => {
	test("normalizes every field the store takes", () => {
		const parsed = createInput({
			title: "  Billing webhook\naccepts orders  ",
			paths: ["./src\\billing\\"],
			priority: "HIGH",
			note: "routes wired;\ntests next",
		});
		expect(parsed).toEqual({
			input: {
				title: "Billing webhook accepts orders",
				paths: ["src/billing"],
				priority: "high",
				note: "routes wired; tests next",
			},
		});
	});

	test("an absent field is its default, and an absent note is no note", () => {
		expect(createInput({ title: "One" })).toEqual({
			input: { title: "One", paths: [], priority: "normal" },
		});
	});

	test("refuses the fields in the order a person fixes them", () => {
		expect(createInput({ title: "  " })).toEqual({ error: "title is required." });
		expect(createInput({ title: "x".repeat(MAX_TITLE + 1) })).toEqual({
			error: `title must be at most ${MAX_TITLE} characters.`,
		});
		expect(createInput({ title: "One", paths: ["/etc/passwd"] })).toEqual({
			error: 'path "/etc/passwd" is absolute; use a repository-relative path.',
		});
		expect(createInput({ title: "One", priority: "urgent" })).toEqual({
			error: "priority must be one of high, normal, low.",
		});
		expect(createInput({ title: "One", note: "   " })).toEqual({ error: "text is required." });
	});

	test("reads a body as untrusted JSON, not as the tool's typed arguments", () => {
		// The page's body is `Record<string, unknown>`, so every field arrives as whatever
		// the browser sent — the normalizers are the only gate.
		expect(createInput({ title: 4, paths: "src", priority: 1, note: {} })).toEqual({ error: "title is required." });
	});
});
