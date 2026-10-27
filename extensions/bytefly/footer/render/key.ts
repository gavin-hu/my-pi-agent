/**
 * A key for one status snapshot: everything the bar draws, and nothing about identity.
 *
 * The footer repaints on every frame, and its snapshot is a fresh object each time — the
 * reader rebuilds it from the session and the host, and prices only what moved — so a memo
 * cannot key on the snapshot itself. It keys on this string instead, and this string is
 * derived from the snapshot's own shape: object keys sorted, a `Map` walked as sorted
 * entries, a list by its items, a primitive by its value.
 *
 * That derivation is the point. A hand-written list of the fields a bar reads is exactly
 * the kind of list that goes stale silently — a field added to `StatusSnapshot` and
 * forgotten here is a bar that keeps showing the old value until something else moves —
 * whereas a walk over the object cannot miss a field that exists.
 *
 * Lengths prefix strings and collection sizes, so no two different snapshots can produce
 * one key by running values together.
 */

import type { StatusSnapshot } from "../types.ts";

/** The key for one snapshot: equal strings mean a frame would draw the same bar. */
export function snapshotKey(snapshot: StatusSnapshot): string {
	return keyPart(snapshot);
}

/** One value's part of the key, tagged by kind so `1` and `"1"` cannot collide. */
function keyPart(value: unknown): string {
	if (value === undefined) return "~";
	if (value === null) return "n";
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return value ? "t" : "f";
	if (typeof value === "string") return `${value.length}:${value}`;
	if (value instanceof Map) {
		// Sorted, because a Map's insertion order is not a fact about what the bar draws.
		const entries = [...value.entries()].map(([key, entry]) => `${keyPart(String(key))}=${keyPart(entry)}`);
		entries.sort();
		return `m${value.size}{${entries.join(",")}}`;
	}
	if (Array.isArray(value)) return `a${value.length}[${value.map(keyPart).join(",")}]`;
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).sort();
		return `o${keys.length}{${keys.map((key) => `${key}:${keyPart(record[key])}`).join(",")}}`;
	}
	return String(value);
}
