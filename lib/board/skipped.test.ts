import { describe, expect, test } from "bun:test";
import { skippedText } from "./skipped.ts";

describe("skippedText", () => {
	test("says nothing when the board read every file", () => {
		expect(skippedText([])).toBe("");
	});

	test("names one refused file and why", () => {
		expect(skippedText([{ file: "0099.json", why: "version 3" }])).toBe(
			"1 file this build cannot read: 0099.json (version 3)",
		);
	});

	test("names every refused file, in the order it was handed them", () => {
		// The store sorts by file name, so the sentence is stable between two reads of the
		// same board — which is what lets the page's signature tell a new refusal from an old.
		expect(
			skippedText([
				{ file: "0042.json", why: "bad JSON" },
				{ file: "0051.json", why: "not a card record" },
			]),
		).toBe("2 files this build cannot read: 0042.json (bad JSON), 0051.json (not a card record)");
	});
});
