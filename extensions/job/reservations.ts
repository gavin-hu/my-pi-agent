/**
 * Cross-process id reservation for background jobs.
 *
 * Ids are global to a project, but each session writes its own registry file, so
 * two sessions starting a job at the same instant could otherwise both pick the
 * same `j<n>` from a stale read. `reserveId` closes that window with an atomic
 * `O_EXCL` create: the winner owns the id, everyone else bumps to the next one.
 *
 * A reservation file (`<id>.lock`) lives from `start` until the id is committed
 * to a registry file, at which point the next load prunes it; clearing or
 * pruning a job releases it immediately. Files are best-effort — an unwritable
 * reservation degrades to the previous read-only allocation.
 */

import { existsSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RESERVATION_RE = /^(j\d+)\.lock$/;

function reservationPath(dir: string, id: string): string {
	return join(dir, `${id}.lock`);
}

/** Numeric suffix of a job id, or undefined for a non-`j<n>` id. */
function idNumber(id: string): number | undefined {
	const match = /^j(\d+)$/.exec(id);
	return match ? Number(match[1]) : undefined;
}

/**
 * Reserve and return the next free id.
 *
 * `taken` (registry ids, live ids, reservations) sets the starting point;
 * `floor` keeps ids monotonic with a stored counter. The `O_EXCL` create is the
 * actual guarantee: a candidate that already exists is skipped.
 */
export function reserveId(dir: string, taken: Iterable<string>, floor = 1): string {
	let next = floor > 0 ? floor : 1;
	for (const id of taken) {
		const number = idNumber(id);
		if (number !== undefined) next = Math.max(next, number + 1);
	}
	for (;;) {
		const id = `j${next}`;
		try {
			writeFileSync(reservationPath(dir, id), "", { flag: "wx" });
			return id;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			next++;
		}
	}
}

/** Every currently reserved job id in `dir`. */
export function listReservedIds(dir: string): string[] {
	try {
		return readdirSync(dir)
			.map((entry) => RESERVATION_RE.exec(entry)?.[1])
			.filter((id): id is string => id !== undefined);
	} catch {
		return [];
	}
}

/** Release a reservation; a missing file is ignored. */
export function releaseReservation(dir: string, id: string): void {
	try {
		const path = reservationPath(dir, id);
		if (existsSync(path)) unlinkSync(path);
	} catch {
		// Best-effort.
	}
}

/** Drop reservations for ids already committed to a registry file. */
export function pruneReservations(dir: string, committed: Iterable<string>): void {
	const ids = new Set(committed);
	for (const id of listReservedIds(dir)) {
		if (ids.has(id)) releaseReservation(dir, id);
	}
}
