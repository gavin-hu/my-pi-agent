/**
 * The test tree's layout.
 *
 * A suite lives beside the extension or `lib/` subsystem it covers, `test/` holds only the
 * shared helpers, the suite manifest, and the package-level contracts, and every test file is
 * declared in `test/suite-manifest.ts` — a root contract under `ROOT_SUITES`, a capability suite
 * under its owner's list. A file outside that shape is a file the next session will not find,
 * which is why this is a gate and not a feature test.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { posix } from "./helpers/files.ts";
import { dirsOf, extensionsDir, filesIn, libDir, repo, testDir } from "./helpers/scan.ts";
import { EXTENSION_SUITES, declaredRootSuites, declaredSuiteFiles } from "./suite-manifest.ts";

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
		// The manifest's fourth list is the whole set: a contract here that is not declared, or a
		// declared one that is gone, is the same failure in either direction.
		const rootTests = readdirSync(testDir)
			.filter((name) => name.endsWith(".test.ts"))
			.map((name) => `test/${name}`)
			.sort();
		expect(rootTests).toEqual(declaredRootSuites());
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
