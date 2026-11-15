/**
 * `attempt`: a promise settled as its value, or the sentence its rejection is.
 *
 * The half of a refusal a door must not forget: a read that fails becomes a line for the model
 * rather than a stack the transcript cannot draw. Its two answers are the whole of it, so the cases
 * are the two a caller branches on.
 */

import { describe, expect, test } from "bun:test";
import { attempt } from "./errors.ts";

describe("attempt", () => {
	test("hands back the value a promise resolves", async () => {
		expect(await attempt(Promise.resolve(7))).toEqual({ value: 7 });
	});

	test("turns a rejection into the sentence a refusal carries", async () => {
		expect(await attempt(Promise.reject(new Error("the store is locked")))).toEqual({
			error: "the store is locked",
		});
	});

	test("stringifies a rejection that is not an Error, as messageOf does", async () => {
		expect(await attempt(Promise.reject("gone"))).toEqual({ error: "gone" });
	});
});
