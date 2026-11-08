/**
 * The card's kind at the record: the closed table, the two normalizers, and the parser.
 *
 * Its own suite rather than more cases in `card.test.ts`, which sits on the suite bar: the
 * kind is one capability, and the record's shape is the other suite's.
 */

import { describe, expect, test } from "bun:test";
import { billingCard as card } from "../../test/helpers/fixtures/board.ts";
import { isCard, matchesQuery } from "./card.ts";
import { CARD_TYPES, breakingOf, normalizeBreaking, normalizeType } from "./kind.ts";

describe("normalizeType and the breaking marker", () => {
	test("an absent type is no type, and an absent marker is not breaking", () => {
		expect(normalizeType(undefined)).toEqual({});
		expect(normalizeBreaking(undefined)).toEqual({ breaking: false });
		expect(breakingOf(card())).toBe(false);
	});

	test("accepts every kind, spelled any way a person writes it", () => {
		for (const type of CARD_TYPES) expect(normalizeType(type.toUpperCase())).toEqual({ type });
		expect(normalizeType(" Bug ")).toEqual({ type: "bug" });
	});

	test("refuses anything else, naming the ones allowed", () => {
		const error = { error: `type must be one of ${CARD_TYPES.join(", ")}.` };
		expect(normalizeType("perf")).toEqual(error);
		expect(normalizeType(1)).toEqual(error);
	});

	test("a breaking marker is a boolean, and only true is breaking", () => {
		expect(normalizeBreaking(true)).toEqual({ breaking: true });
		expect(breakingOf(card({ breaking: true }))).toBe(true);
		expect(breakingOf(card({ breaking: false }))).toBe(false);
		const error = { error: "breaking must be true or false." };
		expect(normalizeBreaking("yes")).toEqual(error);
		expect(normalizeBreaking(1)).toEqual(error);
	});
});

describe("isCard holds the kind and the marker", () => {
	test("accepts a type and a breaking marker, and a card with neither", () => {
		expect(isCard(card({ type: "bug", breaking: true }))).toBe(true);
		expect(isCard(card({ breaking: false }))).toBe(true);
	});

	test("refuses a type it does not know, and a marker that is not a boolean", () => {
		expect(isCard({ ...card(), type: "perf" })).toBe(false);
		expect(isCard({ ...card(), type: 1 })).toBe(false);
		expect(isCard({ ...card(), breaking: "yes" })).toBe(false);
	});
});

describe("a kind is findable by the query", () => {
	test("matches the type word and the breaking marker, and neither on a plain card", () => {
		const bug = card({ type: "bug", breaking: true });
		expect(matchesQuery(bug, "bug")).toBe(true);
		expect(matchesQuery(bug, "BUG")).toBe(true);
		expect(matchesQuery(bug, "break")).toBe(true);
		// The marker's word is the one it prints, so a breaking card is findable by it alone.
		expect(matchesQuery(card({ breaking: true }), "breaking")).toBe(true);
		expect(matchesQuery(card({ type: "bug" }), "breaking")).toBe(false);
		expect(matchesQuery(card(), "bug")).toBe(false);
	});
});
