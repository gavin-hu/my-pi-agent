/**
 * Structure guard for `ROADMAP.md`.
 *
 * The roadmap is hand-maintained prose: items are renumbered, promoted between
 * horizons, and cited from a ledger and a top-three list. This test pins the
 * mechanical half of that contract so a rename cannot leave a dangling
 * reference or an uncapped bucket:
 *
 * - every `**P3 — …**` item id is unique and contiguous per prefix;
 * - every relative link in the file resolves;
 * - every id mentioned anywhere resolves, including the endpoints of a
 *   `P1–P3` range (contiguity covers the middle);
 * - no `Now` or `Next` bucket holds more than the documented cap.
 *
 * It cannot tell that an item has already shipped — that is a judgement made
 * against `git log <last-tag>..main` when the roadmap is reviewed, which is why
 * the file states that rule, and its own *Deliberately left thin* table, in
 * prose.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "..");
const roadmapPath = join(root, "ROADMAP.md");
const roadmap = readFileSync(roadmapPath, "utf-8");
const lines = roadmap.split("\n");

/** An item heading: `- **P1 — Review continuity.** …`. */
const ITEM = /^- \*\*([PSWCF])(\d+) — /;

/** A bucket heading: a bare `**Now**`, `**Next**`, or `**Later**` line. */
const BUCKET = /^\*\*(Now|Next|Later)\*\*$/;

/** The cap the file states in prose under `## How items are ordered`. */
const BUCKET_CAP: Record<string, number> = { Now: 10, Next: 10, Later: Number.POSITIVE_INFINITY };

interface Item {
	prefix: string;
	number: number;
	id: string;
	line: number;
	bucket: string | undefined;
}

function readItems(): Item[] {
	const items: Item[] = [];
	let bucket: string | undefined;
	lines.forEach((text, index) => {
		const bucketMatch = BUCKET.exec(text);
		if (bucketMatch) {
			bucket = bucketMatch[1];
			return;
		}
		if (/^## /.test(text)) bucket = undefined;
		const itemMatch = ITEM.exec(text);
		if (!itemMatch) return;
		items.push({
			prefix: itemMatch[1],
			number: Number(itemMatch[2]),
			id: `${itemMatch[1]}${itemMatch[2]}`,
			line: index + 1,
			bucket,
		});
	});
	return items;
}

const items = readItems();
const knownIds = new Set(items.map((item) => item.id));

/** Every `P1`-shaped token in the file, wherever it appears. */
function referencedIds(): Array<{ id: string; line: number }> {
	const found: Array<{ id: string; line: number }> = [];
	lines.forEach((text, index) => {
		for (const match of text.matchAll(/(?<![A-Za-z0-9])([PSWCF])(\d+)(?![0-9])/g)) {
			found.push({ id: `${match[1]}${match[2]}`, line: index + 1 });
		}
	});
	return found;
}

describe("roadmap item ids", () => {
	test("finds the items the file is expected to have", () => {
		expect(items.length).toBeGreaterThan(0);
	});

	test("uses each id once", () => {
		const seen = new Map<string, number>();
		const duplicates = items.filter((item) => {
			const first = seen.get(item.id);
			if (first !== undefined) return true;
			seen.set(item.id, item.line);
			return false;
		});
		expect(duplicates.map((item) => `${item.id} repeats at line ${item.line}`)).toEqual([]);
	});

	test("numbers each prefix contiguously from 1", () => {
		const prefixes = [...new Set(items.map((item) => item.prefix))];
		const gaps: string[] = [];
		for (const prefix of prefixes) {
			const numbers = items
				.filter((item) => item.prefix === prefix)
				.map((item) => item.number)
				.sort((a, b) => a - b);
			const expected = numbers.map((_, index) => index + 1);
			if (numbers.join(",") !== expected.join(",")) {
				gaps.push(`${prefix}: ${numbers.join(", ")} (expected 1..${numbers.length})`);
			}
		}
		expect(gaps).toEqual([]);
	});
});

describe("roadmap references", () => {
	test("resolves every id the file mentions", () => {
		const dangling = referencedIds()
			.filter((reference) => !knownIds.has(reference.id))
			.map((reference) => `line ${reference.line} names ${reference.id}, which no item defines`);
		expect(dangling).toEqual([]);
	});

	test("resolves every relative link", () => {
		const missing: string[] = [];
		for (const match of roadmap.matchAll(/\]\((\.[^)\s]*)\)/g)) {
			const target = match[1].split("#")[0];
			if (!target) continue;
			const absolute = resolve(dirname(roadmapPath), target);
			if (!existsSync(absolute)) missing.push(`${target} (line ${roadmap.slice(0, match.index).split("\n").length})`);
		}
		expect(missing).toEqual([]);
	});

	test("links to local anchors that exist", () => {
		const headings = new Set(
			lines
				.filter((text) => /^## /.test(text))
				.map((text) =>
					text
						.replace(/^## /, "")
						.trim()
						.toLowerCase()
						.replace(/[^\w\s-]/g, "")
						.replace(/\s+/g, "-"),
				),
		);
		const dangling: string[] = [];
		for (const match of roadmap.matchAll(/\]\(#([^)\s]+)\)/g)) {
			if (!headings.has(match[1])) dangling.push(`#${match[1]}`);
		}
		expect(dangling).toEqual([]);
	});
});

describe("roadmap horizons", () => {
	test("places every item in a bucket", () => {
		const unplaced = items.filter((item) => item.bucket === undefined).map((item) => `${item.id} at line ${item.line}`);
		expect(unplaced).toEqual([]);
	});

	test("keeps every bucket within the cap the file states", () => {
		const counts = new Map<string, number>();
		for (const item of items) {
			if (item.bucket === undefined) continue;
			counts.set(item.bucket, (counts.get(item.bucket) ?? 0) + 1);
		}
		const over = [...counts]
			.filter(([bucket, count]) => count > BUCKET_CAP[bucket])
			.map(([bucket, count]) => `${bucket} holds ${count} items (cap ${BUCKET_CAP[bucket]})`);
		expect(over).toEqual([]);
	});

	test("names the top three items the file ranks first", () => {
		const section = roadmap.slice(roadmap.indexOf("## If only three things ship"), roadmap.indexOf("## Horizons"));
		const named = [...section.matchAll(/\*\*([PSWCF]\d+) — /g)].map((match) => match[1]);
		expect(named).toEqual(["P1", "W1", "C2"]);
	});
});
