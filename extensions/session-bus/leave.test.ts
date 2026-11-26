/**
 * Leaving the bus: the door `/team exit` opens.
 *
 * A join had no inverse — a session stayed in `/team who` until its process ended or the TTL prune
 * collected the row — so a session that joined by mistake, or one that wants to be invisible
 * between cards, kept a name taken, kept mail arriving, and stayed a handoff target. `leave` is
 * `stop` minus the end of the process: the row, its claims and the watch go, while the start and
 * the row's id stay, so a later join re-adds the same id a card is owned by rather than a
 * stranger's.
 *
 * The cases below are the four facts a caller acts on — the claims back, the name free, the watch
 * quiet, the id kept — plus the answer a session that was on no bus gets.
 */
import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SESSION_LABEL_CHANNEL, type SessionLabelEvent } from "../../lib/session-label.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { busToolSession as session, joinBusSession as joins } from "../../test/helpers/fixtures/session-bus-tool.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createSessionBus } from "./runtime.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** Two sessions on one bus, both joined and listening for nothing, in a directory of their own. */
async function pair(prefix: string) {
	const dir = scratchDir(temps, prefix);
	const tom = session(dir, "/repo/peer", "s2", "tom");
	const gavin = session(dir, "/repo/lead", "s1", "gavin");
	await joins(tom);
	await joins(gavin);
	return { tom, gavin };
}

describe("leaving the bus", () => {
	test("gives the claims back and takes the row with it, so a peer stops listing the session", async () => {
		const { tom, gavin } = await pair("pi-leave-");
		await tom.bus.claim(["src/a.ts", "src/b.ts"]);

		const left = await tom.bus.leave();
		expect(left).toEqual({ label: "tom", released: ["src/a.ts", "src/b.ts"] });

		// This session's own answer says it is off the bus, and the peer's read does not list it.
		expect((await tom.bus.status()).onBus).toBe(false);
		const peer = await gavin.bus.status();
		expect(peer.sessions.map((row) => row.label)).toEqual(["gavin"]);
	});

	test("answers no label when the session was on no bus to leave", async () => {
		const dir = scratchDir(temps, "pi-leave-");
		const tom = session(dir, "/repo/peer", "s2", "tom");
		// A start mints the row in memory and writes nothing: nothing has joined it yet.
		await tom.bus.start(tom.ctx);

		expect(await tom.bus.leave()).toEqual({ released: [] });
	});

	test("keeps the id a card is owned by, so the next join is the same session", async () => {
		const { tom } = await pair("pi-leave-");
		const before = (await tom.bus.status()).me.id;
		expect(before).toBe("s2");

		await tom.bus.leave();
		await tom.bus.join({ label: "tom", listen: false });

		const after = await tom.bus.status();
		expect(after.onBus).toBe(true);
		expect(after.me.id).toBe(before);
	});

	test("stops the watch that would speak for a session on no bus", async () => {
		const dir = scratchDir(temps, "pi-leave-");
		const tom = session(dir, "/repo/peer", "s2", "tom");
		await tom.bus.start(tom.ctx);
		await tom.bus.join({ label: "tom", wake: true });
		expect(tom.bus.wantsWake()).toBe(true);

		await tom.bus.leave();
		expect(tom.bus.wantsWake()).toBe(false);
	});

	test("takes the name off the bar, because the session it named is on no bus", async () => {
		const fake = createFakePi();
		const seen: string[] = [];
		fake.pi.events.on(SESSION_LABEL_CHANNEL, (event) => seen.push((event as SessionLabelEvent).label));
		const bus = createSessionBus(fake.pi as ExtensionAPI, {
			dir: scratchDir(temps, "pi-leave-"),
			repo: { root: "/repo/peer", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			watchMs: 0,
		});
		const { ctx } = fakeCtx({ cwd: "/repo/peer", sessionId: "s2", sessionName: "tom" });
		await bus.start(ctx);
		await bus.join({ label: "tom", listen: false });
		// The join published the name; what a leave owes is the answer that clears it, which the
		// footer draws as no chip at all because the team holds no such name.
		seen.length = 0;

		await bus.leave();
		expect(seen).toEqual([""]);
	});
});
