/**
 * Structure guard for `docs/architecture.md`.
 *
 * The page is written as the shape this package commits to, so most of it cannot
 * be checked by a test: a rule is prose. The half that can be is the part that
 * rots first — the names it uses. This pins that half:
 *
 * - every repository path the page names in a code span exists;
 * - every directory under `lib/` is named, so a new layer cannot go unmentioned
 *   (the omission that is easiest to make: `lib/http/` was missing for months);
 * - every roadmap id the page cites resolves, so a closed gap cannot leave a
 *   dangling `F3` in the prose.
 *
 * Deliberately one-directional: it proves what the page names is real, not that
 * the page names everything. Completeness of the extension catalog belongs to
 * `test/extension-load.test.ts`, and the module index to `test/drift.test.ts`.
 * The remaining half — that the page's *rules* are true of the tree — is what
 * `ROADMAP.md` §5 records as gaps, which is why the third check exists.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "..");
const page = readFileSync(join(root, "docs/architecture.md"), "utf-8");
const roadmap = readFileSync(join(root, "ROADMAP.md"), "utf-8");

/** The roots a named path can start from; anything else in a code span is prose. */
const PATH_ROOTS = ["docs/", "extensions/", "lib/", "scripts/", "skills/", "test/", "themes/"];

/** A code span that is a placeholder (`lib/<name>-state.ts`) rather than a path. */
const PLACEHOLDER = /[<>*()[\]{}]/;

/** Every inline code span the page contains. */
function codeSpans(markdown: string): string[] {
	return [...markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

/** The code spans that claim to be a repository path. */
function namedPaths(markdown: string): string[] {
	return codeSpans(markdown).filter(
		(span) =>
			!PLACEHOLDER.test(span) && (span === "package.json" || PATH_ROOTS.some((prefix) => span.startsWith(prefix))),
	);
}

/** Every item id a roadmap defines, e.g. `F3`. */
const ROADMAP_ITEM = /^- \*\*([PSWCF])(\d+) — /;

describe("docs/architecture.md", () => {
	test("names only paths that exist", () => {
		const missing = namedPaths(page).filter((path) => !existsSync(join(root, path)));
		expect(missing).toEqual([]);
	});

	test("names every directory under lib/", () => {
		const named = codeSpans(page).join(" ");
		const layers = readdirSync(join(root, "lib"))
			.filter((name) => statSync(join(root, "lib", name)).isDirectory())
			.filter((name) => !named.includes(`lib/${name}/`));
		expect(layers).toEqual([]);
	});

	test("cites only roadmap items that exist", () => {
		const known = new Set(
			roadmap
				.split("\n")
				.map((line) => ROADMAP_ITEM.exec(line))
				.filter((match) => match !== null)
				.map((match) => `${match[1]}${match[2]}`),
		);
		const cited = new Set(
			[...page.matchAll(/(?<![A-Za-z0-9])([PSWCF])(\d+)(?![0-9])/g)].map((match) => `${match[1]}${match[2]}`),
		);
		const dangling = [...cited].filter((id) => !known.has(id));
		expect(dangling).toEqual([]);
	});
});
