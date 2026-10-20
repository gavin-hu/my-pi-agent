import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../../package.json";
import { SHIPPED_THEMES_DIR, shippedThemeNames } from "./themes.ts";

/** A theme file inside this package's own `themes/` directory. */
function shipped(name: string): { name: string; path: string } {
	return { name, path: join(SHIPPED_THEMES_DIR, `${name}.json`) };
}

describe("shippedThemeNames", () => {
	test("keeps this package's palettes and drops every other theme", () => {
		const names = shippedThemeNames([
			{ name: "dark", path: "/pi/themes/dark.json" },
			shipped("bytefly-dark"),
			{ name: "bytefly-light" },
			{ name: "mine", path: "/home/me/.pi/agent/themes/mine.json" },
			shipped("bytefly-light"),
			{ name: "bytefly-dark", path: "/pkg/node_modules/bytefly/themes/bytefly-dark.json" },
		]);

		expect(names).toEqual(["bytefly-dark", "bytefly-light"]);
	});

	test("matches the directory, not the name, so a look-alike stays out", () => {
		const names = shippedThemeNames([
			{ name: "bytefly-dark", path: join(SHIPPED_THEMES_DIR, "vendor", "bytefly-dark.json") },
			{ name: "bytefly", path: SHIPPED_THEMES_DIR },
		]);

		expect(names).toEqual([]);
	});

	test("resolves the package's own themes directory", () => {
		// The module walks up from `panel/`; a wrong depth would silently drop both
		// palettes from the row, so the files the manifest globs must be there.
		const files = readdirSync(SHIPPED_THEMES_DIR).filter((file) => file.endsWith(".json"));
		expect(files.sort()).toEqual(["bytefly-dark.json", "bytefly-light.json"]);
		expect(pkg.pi.themes).toEqual(["./themes/*.json"]);
	});
});
