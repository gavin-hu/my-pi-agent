import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { listReservedIds, pruneReservations, releaseReservation, reserveId } from "./reservations.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-jobs-reserve-"));
}

describe("reserveId", () => {
	test("starts above the taken ids and reserves the result", () => {
		const dir = tempDir();
		try {
			expect(reserveId(dir, ["j1", "j4"])).toBe("j5");
			expect(listReservedIds(dir)).toContain("j5");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("hands out distinct ids on repeated calls without a registry update", () => {
		const dir = tempDir();
		try {
			const a = reserveId(dir, []);
			const b = reserveId(dir, []);
			// The second call sees the first reservation, so a stale read cannot collide.
			expect(a).not.toBe(b);
			expect(listReservedIds(dir).sort()).toEqual([a, b].sort());
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("honours a floor from a stored counter", () => {
		const dir = tempDir();
		try {
			expect(reserveId(dir, ["j1"], 10)).toBe("j10");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("release / prune", () => {
	test("releaseReservation removes the file and tolerates a missing one", () => {
		const dir = tempDir();
		try {
			const id = reserveId(dir, []);
			releaseReservation(dir, id);
			expect(listReservedIds(dir)).toEqual([]);
			expect(() => releaseReservation(dir, id)).not.toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("pruneReservations drops committed ids and keeps the rest", () => {
		const dir = tempDir();
		try {
			const committed = reserveId(dir, []);
			const pending = reserveId(dir, []);
			pruneReservations(dir, [committed]);
			expect(listReservedIds(dir)).toEqual([pending]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
