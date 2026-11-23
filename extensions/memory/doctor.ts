/**
 * Memory health: what the two stores hold, and whether recall is already
 * dropping notes (pure).
 *
 * The report answers the questions a user cannot see from the notes alone: how
 * many notes and bytes each store carries, how much of the `maxInjectBytes`
 * budget the injection uses and which scope overflowed it, and which notes the
 * conservative `duplicateKey` already considers the same fact. It never changes
 * anything — consolidation is the picker's `m` merge, and the doctor only names
 * the pair to merge.
 *
 * Byte counts are the store file's size on disk (what a user can reason about
 * and compare with the cap), plus the injected body's size; both are exact UTF-8
 * bytes, not a rounded display.
 */

import { clip } from "../../lib/tui/columns.ts";
import type { MemoryConfig } from "./config.ts";
import { groupDigits, injectionPlan, noteProblemDetail, type MemoryEntries } from "./format.ts";
import { MAX_ENTRY_CHARS } from "./schema.ts";
import { duplicateKey, MAX_STORE_BYTES, type MemoryPaths, type NoteProblem } from "./store.ts";
import { noteLabel, type MemoryNote } from "./types.ts";
import { MEMORY_SCOPES, type MemoryScope } from "./types.ts";

/** Longest note text a duplicate line shows. */
const PAIR_NOTE_WIDTH = 60;
/** Label column for the report's rows. */
const LABEL_WIDTH = 11;

/** One store's counts and the file they came from. */
export interface ScopeHealth {
	notes: number;
	/** File size in bytes; `undefined` when the store was not read. */
	bytes?: number;
	/** The store file this row describes, so a report names what a session actually read. */
	path: string;
}

/** Two notes the comparison key treats as one fact, in stored order. */
export interface DuplicatePair {
	scope: MemoryScope;
	/** The note `add` would have kept. */
	kept: string;
	/** The note `add` would have refused as a near-duplicate. */
	duplicate: string;
}

export interface MemoryHealth {
	trusted: boolean;
	inject: boolean;
	/** The `maxInjectBytes` cap in effect. */
	cap: number;
	project: ScopeHealth;
	global: ScopeHealth;
	/** Present while injection is on: the body's bytes and what did not fit. */
	injection?: { bytes: number; omitted: Record<MemoryScope, number> };
	/** How many notes each author wrote, most first, unattributed last. */
	authors: AuthorCount[];
	/** The notes a write through the tool could not have produced, per store. */
	problems: Record<MemoryScope, NoteProblem[]>;
	/** The label this pane's writes carry; `undefined` when it mints no trailer at all. */
	stamp?: string;
	duplicates: DuplicatePair[];
}

export interface HealthInput {
	entries: MemoryEntries;
	sizes: Record<MemoryScope, number | undefined>;
	/** The resolved store files: a row names the file, not only the count. */
	paths: MemoryPaths;
	trusted: boolean;
	config: MemoryConfig;
	/** The over-cap notes the read path found; absent means the report names none. */
	problems?: Record<MemoryScope, NoteProblem[]>;
	/** The pane's own stamp label, so the authors row can say which side of the line it is on. */
	stamp?: string;
}

/** What a note with no label is counted under. */
export const UNATTRIBUTED = "unattributed";

/** One author's share of a store. */
export interface AuthorCount {
	/** The session label, or {@link UNATTRIBUTED}. */
	by: string;
	notes: number;
}

/** How many notes each author wrote, most first and the unattributed last. */
export function authorCounts(entries: MemoryEntries): AuthorCount[] {
	const counts = new Map<string, number>();
	for (const scope of MEMORY_SCOPES) {
		for (const note of entries[scope]) {
			const by = note.by ?? UNATTRIBUTED;
			counts.set(by, (counts.get(by) ?? 0) + 1);
		}
	}
	const last = (by: string) => (by === UNATTRIBUTED ? 1 : 0);
	return [...counts]
		.map(([by, notes]) => ({ by, notes }))
		.sort((a, b) => last(a.by) - last(b.by) || b.notes - a.notes || a.by.localeCompare(b.by));
}

/** Every near-duplicate pair, computed with the store's own comparison key. */
export function duplicatePairs(entries: MemoryEntries): DuplicatePair[] {
	const pairs: DuplicatePair[] = [];
	for (const scope of MEMORY_SCOPES) {
		const kept = new Map<string, MemoryNote>();
		for (const note of entries[scope]) {
			const key = duplicateKey(note.text);
			const first = kept.get(key);
			if (first === undefined) kept.set(key, note);
			else pairs.push({ scope, kept: noteLabel(first), duplicate: noteLabel(note) });
		}
	}
	return pairs;
}

/** Derive the report from the current stores and config. */
export function memoryHealth({ entries, sizes, paths, trusted, config, problems, stamp }: HealthInput): MemoryHealth {
	const scope = (name: MemoryScope): ScopeHealth => {
		const size = sizes[name];
		return { notes: entries[name].length, path: paths[name], ...(size === undefined ? {} : { bytes: size }) };
	};
	const plan = config.inject ? injectionPlan(entries, config.maxInjectBytes) : undefined;
	return {
		trusted,
		inject: config.inject,
		cap: config.maxInjectBytes,
		project: scope("project"),
		global: scope("global"),
		...(plan ? { injection: { bytes: Buffer.byteLength(plan.lines.join("\n"), "utf-8"), omitted: plan.omitted } } : {}),
		authors: authorCounts(entries),
		problems: { project: problems?.project ?? [], global: problems?.global ?? [] },
		...(stamp === undefined ? {} : { stamp }),
		duplicates: duplicatePairs(entries),
	};
}

function row(label: string, text: string): string {
	return `  ${label.padEnd(LABEL_WIDTH)}${text}`;
}

/** `3 notes · 412 B · /repo/.pi/memory.md`, or the reason a store was not read. */
function scopeText(health: MemoryHealth, name: MemoryScope): string {
	const scope = health[name];
	const where = ` · ${scope.path}`;
	if (name === "project" && !health.trusted) return `unavailable (untrusted project)${where}`;
	const notes = `${scope.notes} note${scope.notes === 1 ? "" : "s"}`;
	if (scope.bytes === undefined) return scope.notes === 0 ? `${notes}${where}` : `${notes} · size unknown${where}`;
	// The number, not just the condition: the next act is deciding what to prune.
	const over = scope.bytes > MAX_STORE_BYTES ? ` · past the ${MAX_STORE_BYTES}-byte cap` : "";
	return `${notes} · ${scope.bytes} B${over}${where}`;
}

function injectionText(health: MemoryHealth): string {
	if (!health.inject) return "off (memory.inject is false)";
	if (!health.injection) return "nothing to inject";
	const { bytes, omitted } = health.injection;
	const missing = omitted.project + omitted.global;
	if (missing === 0) return `${bytes} B of ${health.cap} B · all notes fit`;
	const scopes = MEMORY_SCOPES.filter((name) => omitted[name] > 0).map((name) => `${name} ${omitted[name]}`);
	return `${bytes} B of ${health.cap} B · ${missing} omitted (${scopes.join(", ")})`;
}

/** The authors of a store, most first, or what an empty one says. */
function authorText(health: MemoryHealth): string {
	if (health.authors.length === 0) return "none";
	const text = health.authors.map((author) => `${author.by} ${author.notes}`).join(" \u00b7 ");
	if (!health.authors.some((author) => author.by === UNATTRIBUTED)) return text;
	// The file cannot tell a hand edit from a pane that mints no trailer, so say which this one is.
	const mine =
		health.stamp === undefined
			? "this pane mints no trailer either"
			: `this pane stamps as ${health.stamp}, so it is a hand edit or an older build`;
	return `${text} (${mine})`;
}

/** The over-cap notes: one row naming each, with the file, line and length it broke. */
function problemsText(health: MemoryHealth): string[] {
	const total = MEMORY_SCOPES.reduce((sum, name) => sum + health.problems[name].length, 0);
	if (total === 0) return ["none"];
	const limit = groupDigits(MAX_ENTRY_CHARS);
	const lines = [`${total} note${total === 1 ? "" : "s"} over the ${limit}-character limit`];
	for (const name of MEMORY_SCOPES) {
		for (const problem of health.problems[name]) {
			lines.push(`    ${name} ${noteProblemDetail(problem)} \u00b7 ${health[name].path}`);
		}
	}
	return lines;
}

function pairLine(pair: DuplicatePair): string {
	const kept = clip(pair.kept, PAIR_NOTE_WIDTH);
	const duplicate = clip(pair.duplicate, PAIR_NOTE_WIDTH);
	return `    ${pair.scope}  "${kept}" ≈ "${duplicate}"`;
}

/** The `/memory doctor` notice: plain text, one row per fact. */
export function formatHealth(health: MemoryHealth): string {
	const count = health.duplicates.length;
	const duplicates = count === 0 ? "none" : `${count} pair${count === 1 ? "" : "s"} (merge with m in /memory)`;
	const problems = problemsText(health);
	return [
		"Memory health",
		row("project", scopeText(health, "project")),
		row("global", scopeText(health, "global")),
		row("injection", injectionText(health)),
		row("problems", problems[0] ?? "none"),
		...problems.slice(1),
		row("authors", authorText(health)),
		row("duplicates", duplicates),
		...health.duplicates.map(pairLine),
	].join("\n");
}
