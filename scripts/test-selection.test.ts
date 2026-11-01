/**
 * What a scope selects, on a tree small enough to state in the test.
 *
 * The selection is pure, so most cases here are a table over a two-file fake
 * tree rather than a walk of the real 235 declared suites. Two cases each pay
 * the real walk, because "the fake tree behaves" and "the tree is still wired
 * to the manifest" are two different claims.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { textOf } from "../test/helpers/scan.ts";
import { EXTENSION_SUITES, LIB_SUITES, declaredSuiteFiles } from "../test/suite-manifest.ts";
import {
	gatedAmong,
	regionOf,
	reachIndex,
	selectAll,
	selectChanged,
	selectExt,
	selectLib,
	selectRoot,
	selectSlow,
	slowSuites,
	tree,
} from "./test-selection.ts";

const repo = join(import.meta.dir, "..");

/** A tree of two package-level tests, so a selection's `always` half is visible. */
const fake = { root: "/repo", packageTests: ["test/a.test.ts", "test/b.test.ts"] };

/** The suites the manifest declares for one extension. */
const extSuites = (name: string): number => (EXTENSION_SUITES[name] ?? []).length;

/** The suites the manifest declares under one `lib/` area. */
const libArea = (area: string): number =>
	LIB_SUITES.filter((suite) => suite === area || suite.startsWith(`${area}/`)).length;

describe("the region a path belongs to", () => {
	test("an extension, a lib area, a lib module, and a script each name a region", () => {
		const cases: [string, string | undefined][] = [
			["extensions/board/view/pages.ts", "ext:board"],
			["lib/board/store.ts", "lib:board"],
			["lib/tui/layout.ts", "lib:tui"],
			["lib/format.ts", "lib:format"],
			["lib/format.test.ts", "lib:format"],
			["scripts/render-bench.ts", "script:render-bench"],
			["docs/development.md", undefined],
			["README.md", undefined],
			["package.json", undefined],
		];
		const wrong = cases
			.filter(([path, owner]) => regionOf(path) !== owner)
			.map(([path, owner]) => `${path}: ${String(regionOf(path))}, expected ${String(owner)}`);
		expect(wrong).toEqual([]);
	});
});

describe("a named scope", () => {
	test("--ext takes only that extension's declared suites", () => {
		const chosen = selectExt(["board"]);
		expect(chosen.tests.length).toBe(extSuites("board"));
		expect(chosen.tests.filter((file) => !file.startsWith("extensions/board/"))).toEqual([]);
		expect(chosen.reasons).toEqual([`ext:board > ${extSuites("board")} suites`]);
	});

	test("--ext refuses a name nothing declares, and says what there is", () => {
		expect(() => selectExt(["board", "nope"])).toThrow("--ext names no such ext: nope");
		expect(() => selectExt(["board", "nope"])).toThrow("known: board");
		expect(() => selectExt([])).toThrow("--ext names no such ext");
	});

	test("--lib takes the suites whose stem starts with the area", () => {
		expect(selectLib(["format"]).tests).toEqual(["lib/format.test.ts"]);
		const tui = selectLib(["tui"]).tests;
		expect(tui.length).toBe(libArea("tui"));
		expect(tui.filter((file) => !file.startsWith("lib/tui/"))).toEqual([]);
		expect(selectLib(["board"]).tests.length).toBe(libArea("board"));
	});

	test("--lib refuses an area nothing declares", () => {
		expect(() => selectLib(["nope"])).toThrow("--lib names no such lib: nope");
	});

	test("--root is the package-level tests and nothing else", () => {
		const chosen = selectRoot(fake);
		expect(chosen.tests).toEqual(["test/a.test.ts", "test/b.test.ts"]);
		expect(chosen.reasons).toEqual(["package-level > 2 files"]);
	});

	test("--slow is derived from the gate's own import, not a list", () => {
		const derived = slowSuites(repo);
		const gated = selectSlow(repo).tests;
		const extensions = new Set(gated.map((file) => file.split("/")[1]));
		expect([...extensions].sort()).toEqual(["rewind", "session-bus", "worktree"]);
		const silent = gated.filter((file) => !textOf(join(repo, file)).includes("runSlowSuites"));
		expect(silent, "a suite that imports the gate must use it").toEqual([]);
		expect(declaredSuiteFiles().filter((file) => derived.includes(file))).toEqual(gated);
	});
});

describe("--changed", () => {
	const index = new Map([
		["lib/board/store.ts", ["lib/board/store.test.ts", "extensions/board/record.test.ts"]],
		["extensions/board/page.ts", ["extensions/board/page.test.ts"]],
	]);

	test("a changed module brings the suites that import it, the package-level tests always, and its own area", () => {
		const chosen = selectChanged(fake, ["lib/board/store.ts"], index);
		const area = LIB_SUITES.filter((suite) => suite.startsWith("board/")).map((suite) => `lib/${suite}.test.ts`);
		expect(chosen.tests).toEqual(
			["extensions/board/record.test.ts", ...area, "test/a.test.ts", "test/b.test.ts"].sort(),
		);
		expect(chosen.reasons).toEqual([
			"package-level > 2 files, always",
			"reached by lib/board/store.ts > 2 suites",
			`region lib:board > ${libArea("board")} suites`,
		]);
	});

	test("a file nothing imports yet brings its own region, which is what a new module is", () => {
		const chosen = selectChanged(fake, ["extensions/board/added.ts"], index);
		expect(chosen.tests.filter((file) => file.startsWith("extensions/board/")).length).toBe(extSuites("board"));
		expect(chosen.reasons).toContain(`region ext:board > ${extSuites("board")} suites`);
	});

	test("a shared path widens the run to every suite", () => {
		const chosen = selectChanged(fake, ["test/helpers/env.ts"], index);
		expect(chosen.tests).toEqual(selectAll(fake).tests);
		expect(chosen.reasons).toEqual(["shared ground: test/helpers/env.ts > every suite"]);
	});

	test("a clean tree runs the package-level tests, and a path no suite claims says so", () => {
		expect(selectChanged(fake, [], index).tests).toEqual(["test/a.test.ts", "test/b.test.ts"]);
		const docs = selectChanged(fake, ["docs/development.md"], index);
		expect(docs.tests).toEqual(["test/a.test.ts", "test/b.test.ts"]);
		expect(docs.reasons).toContain("no suite reaches these paths > package-level tests only");
	});
});

describe("the reach index over the real tree", () => {
	test("a suite is filed under the module it imports, and no key leaves the repository", () => {
		const reached = reachIndex(repo);
		expect(reached.get("lib/format.ts")).toContain("lib/format.test.ts");
		expect(reached.get("lib/board/store.ts")).toContain("lib/board/store.test.ts");
		const escaped = [...reached.keys()].filter((file) => file.startsWith("..") || file.startsWith("/"));
		expect(escaped, "a dependency is not a file a suite can cover").toEqual([]);
	});

	test("a leaf change stays inside its extension instead of running the suite", () => {
		const chosen = selectChanged(tree(repo), ["extensions/watch/format.ts"], reachIndex(repo));
		const outside = chosen.tests.filter(
			(file) => !file.startsWith("extensions/watch/") && !file.startsWith("test/") && !file.startsWith("scripts/"),
		);
		expect(outside, "a formatter is imported by the capture tooling, and by no other extension").toEqual([]);
		expect(chosen.tests).toContain("extensions/watch/format.test.ts");
		expect(chosen.tests.length).toBeLessThan(declaredSuiteFiles().length / 5);
	});
});

describe("a tree", () => {
	test("reads the package-level tests beside it", () => {
		const read = tree(repo);
		expect(read.packageTests).toContain("test/layout.test.ts");
		expect(read.packageTests.filter((file) => !file.startsWith("test/") || !file.endsWith(".test.ts"))).toEqual([]);
	});
});

describe("the gate among the files a scope picked", () => {
	test("names the gated suites and leaves the rest alone", () => {
		const picked = ["extensions/worktree/flow.test.ts", "extensions/watch/format.test.ts", "lib/format.test.ts"];
		expect(gatedAmong(repo, picked)).toEqual(["extensions/worktree/flow.test.ts"]);
	});

	test("finds nothing in a selection of package-level tests", () => {
		expect(gatedAmong(repo, tree(repo).packageTests)).toEqual([]);
	});
});
