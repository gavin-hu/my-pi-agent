import { describe, expect, test } from "bun:test";
import { RenderCache } from "./render-cache.ts";

/** A build that counts, so a hit is proved by the count rather than the output. */
function counting(lines: string[] = ["a"]) {
	let builds = 0;
	return {
		build: () => {
			builds++;
			return lines;
		},
		builds: () => builds,
	};
}

describe("RenderCache", () => {
	test("returns the same lines while the width and the source are unchanged", () => {
		const cache = new RenderCache();
		const source = ["a"];
		const built = counting(["x"]);

		expect(cache.lines(40, source, built.build)).toBe(cache.lines(40, source, built.build));
	});

	test("does not rebuild on a hit", () => {
		const cache = new RenderCache();
		const source = ["a"];
		const built = counting();

		cache.lines(40, source, built.build);
		cache.lines(40, source, built.build);

		expect(built.builds()).toBe(1);
	});

	test("rebuilds when the width changes", () => {
		const cache = new RenderCache();
		const source = ["a"];
		const built = counting();

		cache.lines(40, source, built.build);
		cache.lines(41, source, built.build);

		expect(built.builds()).toBe(2);
	});

	test("rebuilds when the source array changes, even with the same content", () => {
		const cache = new RenderCache();
		const built = counting();

		cache.lines(40, ["a"], built.build);
		cache.lines(40, ["a"], built.build);

		expect(built.builds()).toBe(2);
	});

	test("rebuilds after invalidate even when nothing else changed", () => {
		const cache = new RenderCache();
		const source = ["a"];
		const built = counting();

		cache.lines(40, source, built.build);
		cache.invalidate();
		cache.lines(40, source, built.build);

		expect(built.builds()).toBe(2);
	});

	test("caches a component with no source on its width alone", () => {
		const cache = new RenderCache();
		const built = counting();

		expect(cache.lines(40, undefined, built.build)).toBe(cache.lines(40, undefined, built.build));
		expect(built.builds()).toBe(1);
	});

	test("drops the cached lines on invalidate", () => {
		const cache = new RenderCache();

		const first = cache.lines(40, undefined, () => ["x"]);
		cache.invalidate();

		expect(cache.lines(40, undefined, () => ["x"])).not.toBe(first);
	});
});
