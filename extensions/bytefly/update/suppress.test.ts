import { describe, expect, test } from "bun:test";
import { type PackageManagerPrototype, suppressPiPackageUpdates } from "./suppress.ts";
import type { PackageUpdate } from "./types.ts";

const UPDATES: PackageUpdate[] = [
	{ source: "@gavin-hu/my-pi-agent", displayName: "@gavin-hu/my-pi-agent", type: "npm", scope: "user" },
];

/** A prototype whose check returns a fixed list. */
function fakePrototype(): PackageManagerPrototype {
	return { checkForAvailableUpdates: async () => UPDATES };
}

describe("suppressPiPackageUpdates", () => {
	test("makes Pi's check report nothing while the captured original still works", async () => {
		const prototype = fakePrototype();
		const suppression = suppressPiPackageUpdates(prototype);
		const manager = {} as never;

		expect(await prototype.checkForAvailableUpdates(manager)).toEqual([]);
		expect(await suppression.check(manager)).toEqual(UPDATES);
	});

	test("restores the original method", async () => {
		const prototype = fakePrototype();
		const original = prototype.checkForAvailableUpdates;
		const suppression = suppressPiPackageUpdates(prototype);
		suppression.restore();

		expect(prototype.checkForAvailableUpdates).toBe(original);
		expect(await prototype.checkForAvailableUpdates({} as never)).toEqual(UPDATES);
	});

	test("is idempotent and does not restore twice over another patch", async () => {
		const prototype = fakePrototype();
		const first = suppressPiPackageUpdates(prototype);
		const second = suppressPiPackageUpdates(prototype);

		expect(second).toBe(first);
		const replacement = async () => [];
		prototype.checkForAvailableUpdates = replacement;
		first.restore();

		expect(prototype.checkForAvailableUpdates).toBe(replacement);
	});

	test("is inert when the host method is missing", async () => {
		const prototype = {} as PackageManagerPrototype;
		const suppression = suppressPiPackageUpdates(prototype);

		expect(await suppression.check({} as never)).toEqual([]);
		expect(() => suppression.restore()).not.toThrow();
	});
});
