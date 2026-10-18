/**
 * Contract guard for `docs/configuration-reference.md`.
 *
 * The page replaced `assets/bytefly.schema.json`, so it is now the list a hand
 * edit is checked against. This test pins every section to the defaults its
 * loader exports: a documented key must exist in the defaults, a default key
 * must be documented, and a scalar or empty-container default must match the
 * JSON literal in the table.
 *
 * A default that is a non-empty object or array (`price.rates`,
 * `price.peak.windows`, `web-access.search`) is described in prose under its
 * table and is not compared here, and `NO_DEFAULT` lists the documented keys
 * that deliberately have no default.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DEFAULT_CHROME_CONFIG } from "../extensions/bytefly/chrome.ts";
import { DEFAULT_CONFIG as DEFAULT_DOCTOR_CONFIG } from "../extensions/bytefly/doctor/config.ts";
import { DEFAULT_BYTEFLY_CONFIG } from "../extensions/bytefly/footer/price/config.ts";
import { DEFAULT_NOTIFY_CONFIG } from "../extensions/bytefly/notify/config.ts";
import { DEFAULT_CONFIG as DEFAULT_DOCUMENT_CONFIG } from "../extensions/document/config.ts";
import { DEFAULT_CONFIG as DEFAULT_FILE_BROWSE_CONFIG } from "../extensions/file-browse/config.ts";
import { DEFAULT_GOAL_CONFIG } from "../extensions/goal/config.ts";
import { DEFAULT_CONFIG as DEFAULT_JOB_CONFIG } from "../extensions/job/config.ts";
import { DEFAULT_MEMORY_CONFIG } from "../extensions/memory/config.ts";
import { DEFAULT_CONFIG as DEFAULT_REWIND_CONFIG } from "../extensions/rewind/config.ts";
import { DEFAULT_TODO_CONFIG } from "../extensions/todo/config.ts";
import { DEFAULT_CONFIG as DEFAULT_WATCH_CONFIG } from "../extensions/watch/config.ts";
import { DEFAULT_CONFIG as DEFAULT_WECHAT_CONFIG } from "../extensions/wechat/config.ts";
import { DEFAULT_FETCH_CONFIG } from "../extensions/web-access/fetch/config.ts";
import { DEFAULT_SEARCH_CONFIG } from "../extensions/web-access/search/config.ts";
import { DEFAULT_CONFIG as DEFAULT_WORKTREE_CONFIG } from "../extensions/worktree/config.ts";

const docs = join(import.meta.dir, "..", "docs");
const reference = readFileSync(join(docs, "configuration-reference.md"), "utf-8");
const configuration = readFileSync(join(docs, "configuration.md"), "utf-8");

/** A documented key whose loader has no default. */
const NO_DEFAULT = new Set(["pollHoldMs"]);

/** One section's defaults, optionally split into named sub-sections. */
type SectionDefaults = unknown | ReadonlyArray<{ prefix: string; defaults: unknown }>;

/** Every section the reference documents, and the defaults that describe it. */
const SECTIONS: Readonly<Record<string, SectionDefaults>> = {
	price: DEFAULT_BYTEFLY_CONFIG,
	notify: DEFAULT_NOTIFY_CONFIG,
	doctor: DEFAULT_DOCTOR_CONFIG,
	chrome: DEFAULT_CHROME_CONFIG,
	document: DEFAULT_DOCUMENT_CONFIG,
	"file-browse": DEFAULT_FILE_BROWSE_CONFIG,
	goal: DEFAULT_GOAL_CONFIG,
	job: DEFAULT_JOB_CONFIG,
	watch: DEFAULT_WATCH_CONFIG,
	memory: DEFAULT_MEMORY_CONFIG,
	rewind: DEFAULT_REWIND_CONFIG,
	todo: DEFAULT_TODO_CONFIG,
	// Two loaders, one section: the document nests `search` and `fetch`.
	"web-access": [
		{ prefix: "search", defaults: DEFAULT_SEARCH_CONFIG },
		{ prefix: "fetch", defaults: DEFAULT_FETCH_CONFIG },
	],
	wechat: DEFAULT_WECHAT_CONFIG,
	worktree: DEFAULT_WORKTREE_CONFIG,
};

/** A plain object that is not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Dotted key paths a config object accepts, with their values. Recurses into
 * nested objects, and stops at an array or an empty container (one row for the
 * parent) or at a map keyed by free-form names such as `price.rates` (also one
 * row, with its child shape in prose).
 */
function keyPaths(value: unknown, prefix = ""): Array<[path: string, value: unknown]> {
	if (!isRecord(value)) return [[prefix, value]];
	const entries = Object.entries(value);
	if (entries.length === 0) return [[prefix, value]];
	// A nested all-record object is a free-form map such as `price.rates`; the
	// root is the section itself, so its objects are nested keys, not map values.
	if (prefix !== "" && entries.every(([, entry]) => isRecord(entry))) return [[prefix, value]];
	return entries.flatMap(([key, entry]) => keyPaths(entry, prefix ? `${prefix}.${key}` : key));
}

/** Every documented key path of one section, with its default cell. */
function documentedRows(section: string): Map<string, unknown> {
	const lines = reference.split("\n");
	const start = lines.findIndex((line) => line.startsWith(`## \`${section}\``));
	if (start === -1) throw new Error(`No \`## ${section}\` section in configuration-reference.md`);
	const rows = new Map<string, unknown>();
	for (const line of lines.slice(start + 1)) {
		if (line.startsWith("## ")) break;
		if (!line.startsWith("|")) continue;
		const cells = line.split("|");
		const key = /^`([^`]+)`$/.exec(cells[1]?.trim() ?? "")?.[1];
		if (!key) continue;
		const raw = /^`(.*)`$/.exec(cells[3]?.trim() ?? "")?.[1];
		rows.set(key, raw === undefined ? undefined : safeParse(raw));
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

/** Whether a documented default is worth comparing: primitives and empty containers. */
function isComparable(value: unknown): boolean {
	if (Array.isArray(value)) return value.length === 0;
	if (isRecord(value)) return Object.keys(value).length === 0;
	return true;
}

/** The `[path, value]` pairs one section's defaults expand to. */
function defaultsOf(section: string): Array<[path: string, value: unknown]> {
	const value = SECTIONS[section];
	const parts = Array.isArray(value) ? value : [{ prefix: "", defaults: value }];
	return parts.flatMap((part) => keyPaths(part.defaults, part.prefix));
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
	test("documents every section the configuration index lists, and no others", () => {
		const documented = reference
			.split("\n")
			.filter((line) => line.startsWith("## `"))
			.map((line) => /^## `([^`]+)`/.exec(line)?.[1] ?? "")
			.filter(Boolean);

		expect(documented.sort()).toEqual(indexedSections().sort());
		expect(documented.sort()).toEqual(Object.keys(SECTIONS).sort());
	});

	test("documents every key each loader reads, and no others", () => {
		for (const section of Object.keys(SECTIONS)) {
			const rows = documentedRows(section);
			const undocumented = defaultsOf(section)
				.map(([path]) => path)
				.filter((path) => !rows.has(path));
			const undeclared = [...rows.keys()].filter(
				(key) => !defaultsOf(section).some(([path]) => path === key) && !NO_DEFAULT.has(key),
			);

			expect([section, undocumented, undeclared]).toEqual([section, [], []]);
		}
	});

	test("states each comparable default the loader carries", () => {
		for (const section of Object.keys(SECTIONS)) {
			const rows = documentedRows(section);
			for (const [path, value] of defaultsOf(section)) {
				if (!isComparable(value)) continue;
				expect([section, path, rows.get(path)]).toEqual([section, path, value]);
			}
		}
	});

	test("leaves no section unchecked", () => {
		expect(Object.keys(SECTIONS)).toHaveLength(15);
	});
});
