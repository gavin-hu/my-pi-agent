import { describe, expect, test } from "bun:test";
import { createPadStore, DEFAULT_HOST_PAD } from "./pad.ts";

describe("createPadStore", () => {
	test("falls back to Pi's default before anything is observed", () => {
		expect(DEFAULT_HOST_PAD).toBe(1);
		expect(createPadStore().resolve()).toBe(1);
		expect(createPadStore(0).resolve()).toBe(0);
	});

	test("resolve records the host pad it is handed", () => {
		const pad = createPadStore();
		expect(pad.resolve(0)).toBe(0);
		expect(pad.resolve()).toBe(0);
		expect(pad.resolve(4)).toBe(4);
		expect(pad.resolve()).toBe(4);
	});

	test("observe records a pad without resolving", () => {
		const pad = createPadStore();
		pad.observe(2);
		expect(pad.resolve()).toBe(2);
	});

	test("keeps whole, non-negative columns and ignores a non-finite pad", () => {
		const pad = createPadStore();
		expect(pad.resolve(-3)).toBe(0);
		expect(pad.resolve(2.7)).toBe(2);
		expect(pad.resolve(Number.NaN)).toBe(2);
		pad.observe(Number.POSITIVE_INFINITY);
		expect(pad.resolve()).toBe(2);
	});
});
