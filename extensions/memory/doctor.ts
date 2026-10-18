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
import { injectionPlan, type MemoryEntries } from "./format.ts";
import { duplicateKey } from "./store.ts";
import { MEMORY_SCOPES, type MemoryScope } from "./types.ts";

/** Longest note text a duplicate line shows. */
const PAIR_NOTE_WIDTH = 60;
/** Label column for the report's rows. */
const LABEL_WIDTH = 11;

/** One store's counts. */
export interface ScopeHealth {
	notes: number;
	/** File size in bytes; `undefined` when the store was not read. */
	bytes?: number;
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
	duplicates: DuplicatePair[];
}

export interface HealthInput {
	entries: MemoryEntries;
	sizes: Record<MemoryScope, number | undefined>;
	trusted: boolean;
	config: MemoryConfig;
}

/** Every near-duplicate pair, computed with the store's own comparison key. */
export function duplicatePairs(entries: MemoryEntries): DuplicatePair[] {
	const pairs: DuplicatePair[] = [];
	for (const scope of MEMORY_SCOPES) {
		const kept = new Map<string, string>();
		for (const note of entries[scope]) {
			const key = duplicateKey(note);
			const first = kept.get(key);
			if (first === undefined) kept.set(key, note);
			else pairs.push({ scope, kept: first, duplicate: note });
		}
	}
	return pairs;
}

/** Derive the report from the current stores and config. */
export function memoryHealth({ entries, sizes, trusted, config }: HealthInput): MemoryHealth {
	const scope = (name: MemoryScope): ScopeHealth => {
		const size = sizes[name];
		return size === undefined ? { notes: entries[name].length } : { notes: entries[name].length, bytes: size };
	};
	const plan = config.inject ? injectionPlan(entries, config.maxInjectBytes) : undefined;
	return {
		trusted,
		inject: config.inject,
		cap: config.maxInjectBytes,
		project: scope("project"),
		global: scope("global"),
		...(plan ? { injection: { bytes: Buffer.byteLength(plan.lines.join("\n"), "utf-8"), omitted: plan.omitted } } : {}),
		duplicates: duplicatePairs(entries),
	};
}

function row(label: string, text: string): string {
	return `  ${label.padEnd(LABEL_WIDTH)}${text}`;
}

/** `3 notes · 412 B`, or the reason a store was not read. */
function scopeText(health: MemoryHealth, name: MemoryScope): string {
	const scope = health[name];
	if (name === "project" && !health.trusted) return "unavailable (untrusted project)";
	const notes = `${scope.notes} note${scope.notes === 1 ? "" : "s"}`;
	if (scope.bytes === undefined) return scope.notes === 0 ? notes : `${notes} · size unknown`;
	return `${notes} · ${scope.bytes} B`;
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

function pairLine(pair: DuplicatePair): string {
	const kept = clip(pair.kept, PAIR_NOTE_WIDTH);
	const duplicate = clip(pair.duplicate, PAIR_NOTE_WIDTH);
	return `    ${pair.scope}  "${kept}" ≈ "${duplicate}"`;
}

/** The `/memory doctor` notice: plain text, one row per fact. */
export function formatHealth(health: MemoryHealth): string {
	const count = health.duplicates.length;
	const duplicates = count === 0 ? "none" : `${count} pair${count === 1 ? "" : "s"} (merge with m in /memory)`;
	return [
		"Memory health",
		row("project", scopeText(health, "project")),
		row("global", scopeText(health, "global")),
		row("injection", injectionText(health)),
		row("duplicates", duplicates),
		...health.duplicates.map(pairLine),
	].join("\n");
}
