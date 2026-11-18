/**
 * Who a picker may touch: an untrusted project is read-only, and the screen says so.
 *
 * Its own suite because `memory-picker.test.ts` is at its line bar, and these cases are about
 * the trust gate rather than about rendering one list.
 */

import { describe, expect, test } from "bun:test";
import { pickerOver } from "../../../test/helpers/fixtures/memory.ts";

describe("MemoryPickerComponent trust", () => {
	test("hides project notes and targets global when untrusted", () => {
		const h = pickerOver({ project: ["secret"], global: ["ok"], trusted: false });

		expect(h.text()).not.toContain("secret");
		expect(h.text()).toContain("ok");
		expect(h.text()).toContain("project untrusted");
	});

	test("adds to global when untrusted", () => {
		const h = pickerOver({ trusted: false });

		h.input("a");

		expect(h.text()).toContain("Add global");
	});

	test("skips the project scope when cycling the filter untrusted", () => {
		const h = pickerOver({ global: ["ok"], trusted: false });

		h.input("s");

		expect(h.text()).toContain("global · ok");
	});
});
