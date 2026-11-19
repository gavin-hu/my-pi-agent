/**
 * The review write path's helpers: placing marker lines, and matching an owner's settlements.
 *
 * `formatFeedback` owns the write itself; this module owns the two pieces that need no draft —
 * where a marker sits in the clean plan, and which stored marker an owner's settlement names.
 * Marker construction and author normalisation arrive as callbacks, so the marker grammar stays
 * in `feedback.ts` and this module imports it for types only.
 */

import { contentBlockAt, type PlanBlock } from "./blocks.ts";
import { sanitizeLine } from "../../lib/format.ts";
import type { PlanAnnotation, StoredMarker } from "./feedback.ts";

/** A marker waiting to be placed after clean-plan line `at`. */
export interface Placed {
	at: number;
	line: string;
}

/**
 * Rebuild `clean` with `entries` inserted after the lines they name, grouping
 * several entries on one line in the order given. `-1` places at the top.
 */
export function compose(clean: string, entries: Placed[]): string {
	if (entries.length === 0) return clean;
	if (clean === "") return entries.map((entry) => entry.line).join("\n");
	const buckets = new Map<number, string[]>();
	for (const entry of entries) {
		const bucket = buckets.get(entry.at) ?? [];
		bucket.push(entry.line);
		buckets.set(entry.at, bucket);
	}
	const lines = clean.split("\n");
	const out: string[] = [];
	const flush = (at: number): void => {
		const bucket = buckets.get(at);
		if (bucket) out.push(...bucket);
	};
	flush(-1);
	lines.forEach((line, index) => {
		out.push(line);
		flush(index);
	});
	// A marker placed past the last line still lands after it rather than nowhere.
	flush(lines.length);
	return out.join("\n");
}

/**
 * The line each kept marker becomes after the owner's settlements.
 *
 * Author, anchor and text must all agree, compared the way the stored body was written:
 * the writer's name through `nameOf` and the text through `sanitizeLine`. Each entry is used
 * once, in list order, so two identical notes pair first-to-first instead of both taking one
 * flag. Only an owner write (`author === ""`) settles another writer's marker; every other
 * marker keeps its own flag.
 */
export function settlementLines(
	markers: readonly StoredMarker[],
	blocks: readonly PlanBlock[],
	author: string,
	entries: readonly PlanAnnotation[],
	lineFor: (marker: StoredMarker, resolved: boolean) => string,
	nameOf: (raw: unknown) => string,
): Placed[] {
	const settle = [...entries];
	const used = new Set<number>();
	const takeSettle = (marker: StoredMarker): PlanAnnotation | undefined => {
		if (author !== "" || marker.author === "") return undefined;
		const start = contentBlockAt(blocks, marker.at)?.start;
		if (start === undefined) return undefined;
		for (let index = 0; index < settle.length; index++) {
			if (used.has(index)) continue;
			const entry = settle[index];
			if (!entry) continue;
			if (nameOf(entry.author) !== marker.author) continue;
			if (entry.anchor !== start) continue;
			if (sanitizeLine(entry.comment) !== sanitizeLine(marker.comment)) continue;
			used.add(index);
			return entry;
		}
		return undefined;
	};
	return markers
		.filter((marker) => marker.author !== author)
		.map((marker) => {
			const settled = takeSettle(marker);
			return { at: marker.at, line: lineFor(marker, settled ? settled.resolved === true : marker.resolved) };
		});
}
