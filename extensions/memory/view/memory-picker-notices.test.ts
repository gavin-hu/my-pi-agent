/**
 * What the picker says after a merge, an update or a forget — the store's answer, not the
 * screen's intention.
 *
 * `format.test.ts` holds the words; this holds the part a pure function cannot prove, which is
 * that the picker asks and reads the answer — and that a refusal leaves the focus where it was
 * instead of moving it to a note that does not exist.
 */

import { describe, expect, test } from "bun:test";
import { settle } from "../../../test/helpers/process.ts";
import { pickerOver } from "../../../test/helpers/fixtures/memory.ts";

describe("MemoryPickerComponent notices", () => {
	test("a merge whose pair vanished says so, and keeps the focus", async () => {
		let asked = 0;
		const h = pickerOver({
			project: ["alpha", "beta"],
			overrides: {
				merge: async () => {
					asked += 1;
					return false;
				},
			},
		});

		h.input("m"); // mark the first note
		h.input("j"); // the second
		h.input("m"); // open the merge editor on the pair
		for (const key of "merged text") h.input(key);
		h.input("\r");
		await settle();

		expect(asked).toBe(1);
		expect(h.text()).toContain("Those notes are no longer both here.");
		expect(h.text()).not.toContain("Merged 2 project notes.");
		// The focus never moved to the note that was never written: Enter opens the one it was
		// on, and the editor replaces the list, so the other note is gone from the frame.
		h.input("\r");
		expect(h.text()).toContain("Memory \u00b7 Edit project");
		expect(h.text()).toContain("beta");
		expect(h.text()).not.toContain("alpha");
	});

	test("an update whose note vanished says so, and writes nothing", async () => {
		const h = pickerOver({
			project: ["a note"],
			overrides: { update: async () => false },
		});

		h.input("e");
		for (const key of "a better note") h.input(key);
		h.input("\r");
		await settle();

		expect(h.text()).toContain("That note is no longer here.");
		expect(h.text()).not.toContain("Updated project note.");
		expect(h.entries.project).toEqual([{ text: "a note" }]);
		// The focus stayed on the note, so Enter opens it again.
		h.input("\r");
		expect(h.text()).toContain("Memory \u00b7 Edit project");
		expect(h.text()).toContain("a note");
	});

	test("a forget that matched nothing says so, and leaves the note on screen", async () => {
		const h = pickerOver({
			project: ["still here"],
			overrides: { forget: async () => false },
		});

		h.input("d");
		h.input("y");
		await settle();

		expect(h.text()).toContain("That note was already gone.");
		expect(h.text()).not.toContain("Forgot project note.");
		// The note is still there and still focused, so a second `d` names the same one.
		h.input("d");
		expect(h.text()).toContain('Forget project note "still here"? y/N');
	});
});
