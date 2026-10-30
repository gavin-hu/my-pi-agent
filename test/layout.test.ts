/**
 * The test tree's layout.
 *
 * A suite lives beside the extension or `lib/` subsystem it covers, `test/` holds only the
 * shared helpers, the suite manifest, and the package-level contracts, and every test file is
 * declared in `test/suite-manifest.ts`. A file outside that shape is a file the next session
 * will not find, which is why this is a gate and not a feature test.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { posix } from "./helpers/files.ts";
import { dirsOf, extensionsDir, filesIn, libDir, repo, testDir } from "./helpers/scan.ts";
import { EXTENSION_SUITES, declaredSuiteFiles } from "./suite-manifest.ts";

const ROOT_TEST_FILES = new Set([
	"architecture-doc.test.ts",
	"boundaries.test.ts",
	"config-docs.test.ts",
	"conventions.test.ts",
	"dependencies.test.ts",
	"doc-counts.test.ts",
	"doc-links.test.ts",
	"docs-parity.test.ts",
	"drift.test.ts",
	"extension-docs.test.ts",
	"extension-load.test.ts",
	"layout.test.ts",
	"module-sizes.test.ts",
	"naming.test.ts",
	"prerequisites.test.ts",
	"prompt-budget.test.ts",
	"refactor-skill.test.ts",
	"release.test.ts",
	"scripts-surface.test.ts",
	"settings-coverage.test.ts",
	"shared-helpers.test.ts",
	"skill-bank.test.ts",
	"suite-sizes.test.ts",
	"theme.test.ts",
	"tool-render.test.ts",
	"tui-conventions.test.ts",
	"wait-budget.test.ts",
]);

/** Every test file the layout governs, relative to the repository root. */
function layoutTestFiles(): string[] {
	return [extensionsDir, libDir, posix(join(repo, "scripts"))]
		.flatMap((root) => filesIn(root))
		.filter((file) => file.endsWith(".test.ts"))
		.map((file) => file.slice(repo.length + 1))
		.sort();
}

describe("test layout", () => {
	test("test/ holds only helpers and package-level tests", () => {
		expect(dirsOf(testDir)).toEqual(["helpers"]);
		const rootTests = readdirSync(testDir).filter((name) => name.endsWith(".test.ts"));
		expect(new Set(rootTests)).toEqual(ROOT_TEST_FILES);
	});

	test("every extension has a declared suite", () => {
		const missing = dirsOf(extensionsDir).filter((name) => (EXTENSION_SUITES[name] ?? []).length === 0);
		expect(missing, "declare a capability suite in test/suite-manifest.ts").toEqual([]);
	});

	test("helper files live only under test/helpers", () => {
		const helperFiles = [extensionsDir, libDir, testDir]
			.flatMap((root) => filesIn(root))
			.filter((file) => file.endsWith("/helpers.ts") && !file.startsWith(`${testDir}/helpers`));
		expect(helperFiles).toEqual([]);
	});

	test("every test file is a declared suite", () => {
		const declared = new Set(declaredSuiteFiles());
		const offenders = layoutTestFiles().filter((file) => !declared.has(file));
		expect(offenders, "declare the suite in test/suite-manifest.ts").toEqual([]);
	});

	test("every declared suite exists", () => {
		const missing = declaredSuiteFiles().filter((file) => !existsSync(join(repo, file)));
		expect(missing, "create the declared suite, or remove it from the manifest").toEqual([]);
	});
});
