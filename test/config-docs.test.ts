/**
 * Contract guard for `docs/configuration-reference.md`.
 *
 * The page replaced `assets/bytefly.schema.json`, so it is now the list a hand
 * edit is checked against. This test pins the four sections bytefly owns
 * (`price`, `notify`, `doctor`, `chrome`) to their loaders' exported defaults:
 * every documented key path must exist in the defaults, every default key path
 * must be documented, and a scalar default must match the JSON literal in the
 * table. It also keeps the page and `docs/configuration.md`'s section index from
 * drifting apart.
 *
 * A default that is a non-empty object or array (`price.rates`, `peak.windows`)
 * is described in prose under its table and is not compared here, and the other
 * eleven sections are transcribed from loaders that do not export their
 * defaults, so their keys are not compared either.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DEFAULT_CHROME_CONFIG } from "../extensions/bytefly/chrome.ts";
import { DEFAULT_CONFIG as DEFAULT_DOCTOR_CONFIG } from "../extensions/bytefly/doctor/config.ts";
import { DEFAULT_BYTEFLY_CONFIG } from "../extensions/bytefly/footer/price/config.ts";
import { DEFAULT_NOTIFY_CONFIG } from "../extensions/bytefly/notify/config.ts";

const docs = join(import.meta.dir, "..", "docs");
const reference = readFileSync(join(docs, "configuration-reference.md"), "utf-8");
const configuration = readFileSync(join(docs, "configuration.md"), "utf-8");

/** A plain object that is not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/** One row of a documented section. */
interface DocumentedRow {
	key: string;
	/** The `Default` cell parsed as JSON, or `undefined` when it holds prose. */
	defaultValue?: unknown;
}

/**
 * Dotted key paths a config object accepts, with their values. Recurses into
 * nested objects, and stops at an array (one row for the parent) or at a map
 * keyed by free-form names such as `price.rates` (also one row, with its child
 * shape in prose).
 */
function keyPaths(value: unknown, prefix = ""): Array<[path: string, value: unknown]> {
	if (!isRecord(value)) return [[prefix, value]];
	const entries = Object.entries(value);
	const mapLike = entries.length > 0 && entries.every(([, entry]) => isRecord(entry));
	if (mapLike) return [[prefix, value]];
	return entries.flatMap(([key, entry]) => keyPaths(entry, prefix ? `${prefix}.${key}` : key));
}

/** Whether a documented default is worth comparing: primitives and empty containers. */
function isComparable(value: unknown): boolean {
	if (Array.isArray(value)) return value.length === 0;
	if (isRecord(value)) return Object.keys(value).length === 0;
	return true;
}

/** The rows of one `## \`section\`` block, in document order. */
function documentedRows(section: string): DocumentedRow[] {
	const lines = reference.split("\n");
	const start = lines.findIndex((line) => line.startsWith(`## \`${section}\``));
	if (start === -1) throw new Error(`No \`## ${section}\` section in configuration-reference.md`);
	const rows: DocumentedRow[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line.startsWith("## ")) break;
		if (!line.startsWith("|")) continue;
		const cells = line.split("|");
		const key = /^`([^`]+)`$/.exec(cells[1]?.trim() ?? "")?.[1];
		if (!key) continue;
		const raw = /^`(.*)`$/.exec(cells[3]?.trim() ?? "")?.[1];
		rows.push({ key, defaultValue: raw === undefined ? undefined : safeParse(raw) });
	}
	return rows;
}

/** `JSON.parse` that reports prose as `undefined` instead of throwing. */
function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/** The section names a `## Section index` table lists, split out of its cells. */
function indexedSections(): string[] {
	const lines = configuration.split("\n");
	const start = lines.findIndex((line) => line.startsWith("## Section index"));
	if (start === -1) throw new Error("No `## Section index` in configuration.md");
	const sections: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line.startsWith("## ")) break;
		if (!line.startsWith("|")) continue;
		const cell = line.split("|")[2];
		if (!cell) continue;
		for (const name of cell.split(",")) {
			const cleaned = name.trim().replaceAll("`", "");
			// Skip the header cell and the `|---|---|` separator row.
			if (/^[a-z][a-z0-9-]*$/.test(cleaned) && cleaned !== "section") sections.push(cleaned);
		}
	}
	return sections;
}

describe("configuration reference", () => {
	test("documents every section the configuration index lists", () => {
		const documented = reference
			.split("\n")
			.filter((line) => line.startsWith("## `"))
			.map((line) => /^## `([^`]+)`/.exec(line)?.[1] ?? "")
			.filter(Boolean);

		expect(documented.sort()).toEqual(indexedSections().sort());
	});

	test("documents every key the bytefly loaders read, and no others", () => {
		const sections = {
			price: DEFAULT_BYTEFLY_CONFIG,
			notify: DEFAULT_NOTIFY_CONFIG,
			doctor: DEFAULT_DOCTOR_CONFIG,
			chrome: DEFAULT_CHROME_CONFIG,
		};
		for (const [section, defaults] of Object.entries(sections)) {
			expect([
				section,
				documentedRows(section)
					.map((row) => row.key)
					.sort(),
			]).toEqual([
				section,
				keyPaths(defaults)
					.map(([path]) => path)
					.sort(),
			]);
		}
	});

	test("states each comparable default the loader carries", () => {
		const sections = {
			price: DEFAULT_BYTEFLY_CONFIG,
			notify: DEFAULT_NOTIFY_CONFIG,
			doctor: DEFAULT_DOCTOR_CONFIG,
			chrome: DEFAULT_CHROME_CONFIG,
		};
		for (const [section, defaults] of Object.entries(sections)) {
			const rows = new Map(documentedRows(section).map((row) => [row.key, row.defaultValue]));
			for (const [path, value] of keyPaths(defaults)) {
				if (!isComparable(value)) continue;
				expect([section, path, rows.get(path)]).toEqual([section, path, value]);
			}
		}
	});
});
