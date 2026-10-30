/**
 * The doc tree's links, anchors, and tables.
 *
 * A contributor follows every one of these links and renders every one of these tables on
 * GitHub, and no compiler reads them: a renamed heading, a moved file, a raw `|` inside a cell,
 * or a path joined with the host's own separator is invisible until a reader hits it.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { posix as posixPath } from "node:path";
import { describe, expect, test } from "bun:test";
import { posix } from "./helpers/files.ts";
import { filesIn, repo, textOf } from "./helpers/scan.ts";

/**
 * A path in posix form, from parts that may arrive with either separator.
 * The doc-link guard slices a path at `/` to find the linking doc's directory, so
 * the host's `join` returning backslashes on Windows would make every root doc's
 * links look broken.
 */
const docPath = (...parts: string[]): string => posix(posixPath.join(...parts));

describe("doc links", () => {
	/** Every Markdown doc a user or contributor reads, from the root and the doc trees. */
	function docFiles(): string[] {
		const trees = ["docs", "extensions", "lib", "scripts", "skills", "test", ".github"].map((dir) =>
			docPath(repo, dir),
		);
		const rootDocs = readdirSync(repo)
			.filter((name) => name.endsWith(".md"))
			.map((name) => docPath(repo, name));
		return [...rootDocs, ...trees.flatMap((tree) => filesIn(tree))].filter((file) => file.endsWith(".md")).sort();
	}

	const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;
	const HEADING = /^#{1,6}\s+(.+?)\s*$/;
	const FENCE = /^\s*(?:```|~~~)/;

	/** GitHub's heading anchor: link text kept, emphasis dropped, punctuation gone, spaces hyphenated. */
	function anchorOf(heading: string): string {
		return heading
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/[`*]/g, "")
			.toLowerCase()
			.replace(/[^\p{L}\p{N} _-]/gu, "")
			.trim()
			.replace(/ /g, "-");
	}

	/** The anchors a rendered page offers, including GitHub's `-1`, `-2` suffixes for repeats. */
	function anchorsOf(text: string): Set<string> {
		const anchors = new Set<string>();
		const seen = new Map<string, number>();
		let fenced = false;
		for (const line of text.split("\n")) {
			if (FENCE.test(line)) {
				fenced = !fenced;
				continue;
			}
			const heading = fenced ? null : HEADING.exec(line)?.[1];
			if (heading === undefined || heading === null) continue;
			const base = anchorOf(heading);
			const count = seen.get(base) ?? 0;
			seen.set(base, count + 1);
			anchors.add(count === 0 ? base : `${base}-${count}`);
		}
		return anchors;
	}

	test("a doc path keeps one separator style whatever the host's join does", () => {
		expect(docPath("D:\\a\\my-pi-agent", "docs", "..", "README.md")).toBe("D:/a/my-pi-agent/README.md");
	});

	test("hyphenates each space, so an em dash between words leaves two", () => {
		// GitHub replaces every space, it does not collapse a run of them.
		expect(anchorOf("`price` — cost calculation")).toBe("price--cost-calculation");
	});

	/** A table's `|---|:--:|` separator row, which fixes the column count its header opens. */
	function isSeparator(line: string): boolean {
		return line.trim().startsWith("|") && /^[\s|:-]+$/.test(line) && line.includes("-");
	}

	/** The unescaped `|` runs in a row: a `\|` is content, not a cell boundary. */
	function cellPipes(line: string): number {
		let count = 0;
		for (let at = 0; at < line.length; at++) {
			if (line[at] === "\\") at++;
			else if (line[at] === "|") count++;
		}
		return count;
	}

	test("every table row has as many cells as its header, fences excepted", () => {
		// A raw `|` inside a cell splits it, so the row renders with an extra column and
		// the text meant for the last one lands where a reader does not expect it. The
		// separator row fixes the count; one `\|` keeps a literal pipe inside the cell.
		const offenders: string[] = [];
		for (const file of docFiles()) {
			const relative = file.slice(repo.length + 1);
			const lines = textOf(file).split("\n");
			let fenced = false;
			for (const [index, line] of lines.entries()) {
				if (FENCE.test(line)) {
					fenced = !fenced;
					continue;
				}
				if (fenced || !line.trim().startsWith("|")) continue;
				if (!isSeparator(lines[index + 1] ?? "")) continue;
				const cells = cellPipes(line);
				for (let row = index + 1; row < lines.length && lines[row].trim().startsWith("|"); row++) {
					const got = cellPipes(lines[row]);
					if (got !== cells) {
						offenders.push(
							`${relative}:${row + 1}: ${got} pipes in a ${cells}-column row; escape a literal one as \\|`,
						);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	test("every relative doc link resolves, anchor included", () => {
		const offenders: string[] = [];
		for (const file of docFiles()) {
			const relative = file.slice(repo.length + 1);
			const dir = file.slice(0, file.lastIndexOf("/"));
			for (const [, link] of textOf(file).matchAll(MARKDOWN_LINK)) {
				if (!link.startsWith("./") && !link.startsWith("../") && !link.startsWith("#")) continue;
				const hash = link.indexOf("#");
				const target = hash === -1 ? link : link.slice(0, hash);
				const anchor = hash === -1 ? "" : link.slice(hash + 1);
				const path = target === "" ? file : docPath(dir, target);
				if (!existsSync(path)) {
					offenders.push(`${relative}: ${link} (no such path)`);
					continue;
				}
				if (anchor !== "" && (!statSync(path).isFile() || !anchorsOf(textOf(path)).has(anchor))) {
					offenders.push(`${relative}: ${link} (no such anchor)`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
