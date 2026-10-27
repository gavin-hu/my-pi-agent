/**
 * The per-instance render memo: the two forms, and what each compares.
 *
 * `lines()` chains on the inner component's array by identity, which is exact while Pi's
 * own components cache their output. `keyed()` is for a component with no inner component:
 * it describes the inputs it read, and this pins what "the same key" means — primitives by
 * value, an object by identity — so a component that leaves a part out finds out here.
 */

import { describe, expect, test } from "bun:test";
import { RenderCache } from "./render-cache.ts";

describe("RenderCache.lines", () => {
	test("rebuilds only when the width or the inner lines change", () => {
		const cache = new RenderCache();
		const inner = ["a", "b"];
		let built = 0;
		const build = (): string[] => {
			built += 1;
			return [...inner, String(built)];
		};

		const first = cache.lines(40, inner, build);
		expect(cache.lines(40, inner, build)).toBe(first);
		expect(built).toBe(1);

		cache.lines(20, inner, build);
		expect(built).toBe(2);
		// A new array with the same content is a new frame's render: identity, not equality.
		cache.lines(20, [...inner], build);
		expect(built).toBe(3);
	});

	test("invalidate drops the memo", () => {
		const cache = new RenderCache();
		let built = 0;
		const build = (): string[] => {
			built += 1;
			return [String(built)];
		};
		cache.lines(40, undefined, build);
		cache.invalidate();
		expect(cache.lines(40, undefined, build)).toEqual(["2"]);
	});
});

describe("RenderCache.keyed", () => {
	test("serves a repeat key and rebuilds when any part moves", () => {
		const cache = new RenderCache();
		const theme = { name: "dark" };
		let built = 0;
		const build = (): string[] => {
			built += 1;
			return [`frame ${built}`];
		};

		const first = cache.keyed([120, theme, "view-a"], build);
		expect(cache.keyed([120, theme, "view-a"], build)).toBe(first);
		expect(built).toBe(1);

		// A value part that changed rebuilds.
		cache.keyed([120, theme, "view-b"], build);
		expect(built).toBe(2);
		// So does a different theme identity, whose strings are the cache's content.
		cache.keyed([120, { name: "dark" }, "view-b"], build);
		expect(built).toBe(3);
		// And a different width, which is a part like any other.
		cache.keyed([80, theme, "view-b"], build);
		expect(built).toBe(4);
	});

	test("compares positions, so a shorter key is a different key", () => {
		const cache = new RenderCache();
		let built = 0;
		const build = (): string[] => {
			built += 1;
			return [String(built)];
		};
		cache.keyed([1, "a"], build);
		// A key that lost a part is not the key it was: this is the shape of a key that
		// forgets the width, and it must miss rather than serve the old frame.
		expect(cache.keyed([1], build)).toEqual(["2"]);
		expect(cache.keyed([1, undefined], build)).toEqual(["3"]);
		expect(cache.keyed([1, undefined], build)).toEqual(["3"]);
	});

	test("invalidate drops the memo, which is what a theme change relies on", () => {
		const cache = new RenderCache();
		let built = 0;
		const build = (): string[] => {
			built += 1;
			return [String(built)];
		};
		cache.keyed([120, "k"], build);
		cache.invalidate();
		expect(cache.keyed([120, "k"], build)).toEqual(["2"]);
	});
});
