/**
 * One record, two readers: the bus's store and the page's roster, reading the same file.
 *
 * The defect this pins is *two accidental policies* — a record whose optional field is the wrong
 * shape drawing on the page while owning no claim and no name, because the bus refused it and the
 * roster did not. Since #994 there is one parser, so the pair below asserts **the same outcome**
 * through both readers: a case per reader could each pass while the two drifted apart again.
 *
 * The second case is the behaviour change the card owns: the roster now requires what the bus
 * requires, so a record missing a required field stops drawing a row where it used to be listed.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRoster } from "../../lib/session-roster.ts";
import { SESSIONS_DIR_NAME } from "../../lib/session-files.ts";
import { busStoreFixture, sessionRecord } from "../../test/helpers/bus.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import type { SessionRecord } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("one record, read by the bus and the page", () => {
	test("is the same session in both, with a bad optional field dropped rather than the record", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.ensure();
		// Only a hand-edited record can hold this: one optional field of the wrong shape, and every
		// other field a record has.
		await store.writeSession({ ...sessionRecord("s1"), watching: "on" } as unknown as SessionRecord);

		const bus = (await store.sessions()).map((entry) => entry.id);
		const page = (await readRoster(dir))?.map((session) => session.id);
		// The fact the card rests on: the two readers agree, so neither can draw a session the
		// other refuses.
		expect(bus).toEqual(["s1"]);
		expect(page).toEqual(["s1"]);
		// And the field the record could not state is absent from what both of them read.
		expect((await store.session("s1"))?.watching).toBeUndefined();
		expect((await readRoster(dir))?.[0]?.watching).toBeUndefined();
	});

	test("stops drawing a row when a required field is missing — the behaviour #994 changes", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.ensure();
		// A record written before a required field existed, or by a build that did not write one.
		const half = { ...sessionRecord("s1"), pid: undefined } as unknown as SessionRecord;
		await store.writeSession(half);
		await store.writeSession(sessionRecord("s2"));

		// The page used to draw `s1` from four fields while the bus refused it; one writer has
		// existed since #992, so a record this build cannot read is not a session either reader has.
		expect((await readRoster(dir))?.map((session) => session.id)).toEqual(["s2"]);
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s2"]);
	});

	test("names a record it could not read, and leaves the file where it is", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.ensure();
		const broken = join(dir, SESSIONS_DIR_NAME, "broken.json");
		writeFileSync(broken, "{ not a record\n", "utf-8");

		const pruned = await store.pruneRecords({ now: 1_000, activeIds: new Set(), sessionTtlMs: 600_000 });
		// Named, not deleted: a newer build wrote it, so an older one must not destroy it — the rule
		// `session-mail.ts` already keeps for a message it cannot read.
		expect(pruned.refused).toEqual(["broken.json"]);
		expect(existsSync(broken)).toBe(true);
	});
});

describe("the bus's own read of one record", () => {
	test("keeps the listening field, and drops one that is not the shape the bus writes", async () => {
		const { store } = busStoreFixture(temps);
		await store.ensure();
		await store.writeSession({ ...sessionRecord("s1"), watching: { armed: true, wake: true } });
		expect((await store.session("s1"))?.watching).toEqual({ armed: true, wake: true });
		// The cast is the point of the case: only a hand-edited record can hold this, and a
		// reader that trusted it would report mail that cannot arrive. It costs the field and not
		// the record (#994) — a record refused here is a session the page draws and the bus does
		// not, which is the failure the two readers disagreeing used to produce.
		const broken = { ...sessionRecord("s2"), watching: "on" } as unknown as SessionRecord;
		await store.writeSession(broken);
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1", "s2"]);
		expect((await store.session("s2"))?.watching).toBeUndefined();
	});

	test("keeps the start token, and drops one that is not a string", async () => {
		const { store } = busStoreFixture(temps);
		await store.ensure();
		await store.writeSession({ ...sessionRecord("s1"), startToken: "Mon Oct 26 00:02:00 2026" });
		expect((await store.session("s1"))?.startToken).toBe("Mon Oct 26 00:02:00 2026");
		// Only a hand-edited record can hold this, and a rule that trusted it would call a live
		// session gone. The record is kept and the token is not: one optional field never costs
		// the session (#994).
		const broken = { ...sessionRecord("s2"), startToken: 7 } as unknown as SessionRecord;
		await store.writeSession(broken);
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1", "s2"]);
		expect((await store.session("s2"))?.startToken).toBeUndefined();
	});

	test("keeps the turn stamp, and drops one that is not a number", async () => {
		const { store } = busStoreFixture(temps);
		await store.ensure();
		await store.writeSession({ ...sessionRecord("s1"), turnAt: 7 });
		expect((await store.session("s1"))?.turnAt).toBe(7);
		// Only a hand-edited record can hold this. The roster used to drop the bad field and keep
		// the row while the bus skipped the record, so one file was two answers; since #994 there
		// is one parser, and both readers keep the session and drop the stamp.
		const broken = { ...sessionRecord("s2"), turnAt: "working" } as unknown as SessionRecord;
		await store.writeSession(broken);
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1", "s2"]);
		expect((await store.session("s2"))?.turnAt).toBeUndefined();
	});
});
