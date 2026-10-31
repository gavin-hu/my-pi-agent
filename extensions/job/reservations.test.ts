import { afterEach, describe, expect, test } from "bun:test";
import { listReservedIds, pruneReservations, releaseReservation, reserveId } from "./reservations.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterEach(() => {
	temps.flush();
});

describe("job reservations", () => {
	test("reserveId starts above the taken ids and reserves the result", async () => {
		const dir = temps.track(tempDir("pi-jobs-reserve-"));
		expect(reserveId(dir, ["j1", "j4"])).toBe("j5");
		expect(listReservedIds(dir)).toContain("j5");
	});

	test("reserveId hands out distinct ids on repeated calls without a registry update", async () => {
		const dir = temps.track(tempDir("pi-jobs-reserve-"));
		const a = reserveId(dir, []);
		const b = reserveId(dir, []);
		// The second call sees the first reservation, so a stale read cannot collide.
		expect(a).not.toBe(b);
		expect(listReservedIds(dir).sort()).toEqual([a, b].sort());
	});

	test("reserveId honours a floor from a stored counter", async () => {
		const dir = temps.track(tempDir("pi-jobs-reserve-"));
		expect(reserveId(dir, ["j1"], 10)).toBe("j10");
	});

	test("releaseReservation removes the file and tolerates a missing one", async () => {
		const dir = temps.track(tempDir("pi-jobs-reserve-"));
		const id = reserveId(dir, []);
		releaseReservation(dir, id);
		expect(listReservedIds(dir)).toEqual([]);
		expect(() => releaseReservation(dir, id)).not.toThrow();
	});

	test("pruneReservations drops committed ids and keeps the rest", async () => {
		const dir = temps.track(tempDir("pi-jobs-reserve-"));
		const committed = reserveId(dir, []);
		const pending = reserveId(dir, []);
		pruneReservations(dir, [committed]);
		expect(listReservedIds(dir)).toEqual([pending]);
	});
});
