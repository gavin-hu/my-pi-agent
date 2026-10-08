import { describe, expect, test } from "bun:test";
import { FOLDER_ICON, iconHref, languageOf, SPRITE } from "../../extensions/serve/icons.ts";

describe("languageOf", () => {
	test("maps languages, docs, config, archives, and images", () => {
		expect(languageOf("a.ts")).toMatchObject({ icon: "file-code", label: "TypeScript" });
		expect(languageOf("a.PY")).toMatchObject({ icon: "file-code", label: "Python" });
		expect(languageOf("README.md")).toMatchObject({ icon: "file-text", colorClass: "doc" });
		expect(languageOf("package.json")).toMatchObject({ icon: "file-json", colorClass: "cfg" });
		expect(languageOf("bundle.zip")).toMatchObject({ icon: "file-archive", colorClass: "arc" });
		expect(languageOf("logo.png")).toMatchObject({ icon: "file-image", colorClass: "img" });
	});

	test("recognizes dotfiles and the unknown fallback", () => {
		expect(languageOf(".env")).toMatchObject({ colorClass: "cfg" });
		expect(languageOf("mystery")).toMatchObject({ icon: "file", label: "File" });
	});
});

describe("icon sprite", () => {
	test("contains a symbol for every icon the mapping can return", () => {
		const names = [
			FOLDER_ICON.icon,
			languageOf("a.ts").icon,
			languageOf("a.md").icon,
			languageOf("a.json").icon,
			languageOf("a.zip").icon,
			languageOf("a.png").icon,
			languageOf("mystery").icon,
		];
		for (const name of names) {
			expect(SPRITE).toContain(`id="i-${name}"`);
			expect(iconHref(name)).toBe(`#i-${name}`);
		}
	});
});
