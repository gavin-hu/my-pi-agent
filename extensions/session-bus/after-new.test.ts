/**
 * A `/new` on a running bus: the row it keeps, the beat that keeps the row, and the mail.
 *
 * `own-record.test.ts` pins which row a start serves; this suite pins what happens after it — the
 * half a row on disk cannot answer by itself. A served row is only worth keeping while the process
 * goes on beating it: with no beat its `lastSeen` is the stamp the shutdown left, so a peer's prune
 * takes the row and its claims once the TTL passes, and the session that reset stops holding its own
 * card. The mail is the same fact seen from the other side: a message lands in the inbox of the id
 * the previous transcript had, and the only way the next transcript can read it is to serve that id.
 *
 * The extension is loaded for real — `session_start` and `session_shutdown` are emitted at it — so
 * these cases fail if the host's event stops reaching `start`/`stop`: a `/new` shutdown would remove
 * the row, and the successor would mint one. The bus is built on the fake host rather than on an
 * empty double, which is what lets a case watch the label channel the footer itself reads.
 */

import { afterAll, describe, expect, test } from "bun:test";
import sessionBus from "./index.ts";
import { createSessionBus } from "./runtime.ts";
import { createBusStore } from "./store.ts";
import { SESSION_LABEL_CHANNEL, type SessionLabelEvent } from "../../lib/session-label.ts";
import { SESSION_TTL_MS } from "../../lib/session-roster.ts";
import { busMessage, landMessage } from "../../test/helpers/bus.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** This process, as the bus records it: the pid and the start token a `/new` keeps. */
const PID = 4_242;
const TOKEN = "started-here";

/**
 * One process's bus, with the two transcripts a `/new` swaps between it.
 *
 * The clock is a number rather than a stub so a heartbeat can be driven by hand: the interval is
 * recorded and never scheduled, which is what lets a case advance ten minutes and tick once.
 */
function world() {
	let now = 1_000_000;
	const ticks: Array<() => Promise<void> | void> = [];
	const dir = scratchDir(temps, "pi-session-bus-");
	const open = (sessionId: string, pid = PID) => {
		const fake = createFakePi();
		const bus = createSessionBus(fake.pi, {
			dir,
			pid,
			alive: () => true,
			startTokenFn: () => TOKEN,
			now: () => now,
			heartbeatMs: 10,
			watchMs: 0,
			interval: (_ms, callback) => {
				ticks.push(callback);
				return () => {};
			},
			repo: { root: "/repo", key: "shared" },
		});
		sessionBus(fake.pi, { bus });
		return { ...fake, bus, ctx: fakeCtx({ cwd: "/repo", sessionId }).ctx };
	};
	return {
		dir,
		open,
		ticks,
		now: () => now,
		advance: (ms: number) => {
			now += ms;
		},
		/** One heartbeat, landed: the interval's callback is not awaited by anything. */
		beat: async () => {
			for (const tick of ticks.splice(0)) await tick();
			await Bun.sleep(1);
		},
	};
}

/** A shutdown the host calls a `/new`: the one reason that keeps the row. */
async function reset(from: ReturnType<ReturnType<typeof world>["open"]>) {
	await emit(from.pi, "session_shutdown", { type: "session_shutdown", reason: "new" }, from.ctx);
}

describe("a `/new` on a running bus", () => {
	test("the served transcript is the one the label channel names, and Pi's title with it", async () => {
		const land = world();
		const before = land.open("s-old");
		await emit(before.pi, "session_start", { type: "session_start", reason: "startup" }, before.ctx);
		await before.bus.join({ label: "tom", listen: false });

		// The transcript the reset leaves, as its own footer would subscribe to it: the id it has is the
		// only one it can match a published name against.
		const after = land.open("s-new");
		const published: SessionLabelEvent[] = [];
		after.pi.events.on(SESSION_LABEL_CHANNEL, (event: unknown) => published.push(event as SessionLabelEvent));
		await reset(before);
		await emit(after.pi, "session_start", { type: "session_start", reason: "new" }, after.ctx);
		await after.bus.start(after.ctx);

		// The row is the process's, and keeps the id the previous transcript minted; the name goes to the
		// transcript on screen, which is the one whose footer is listening.
		expect((await after.bus.status()).me).toEqual({ id: "s-old", label: "tom" });
		expect(published.at(-1) ?? undefined).toEqual({ id: "s-new", label: "tom" });
		// Pi's title is an entry in the transcript's own file, so the reset cleared it and the served start
		// is what puts it back: without it a `/resume` of this id starts from the repository's name.
		expect(after.pi.getSessionName()).toBe("tom");
	});

	test("the row it kept is still the session's own, with its claims, after a peer's prune past the TTL", async () => {
		const land = world();
		const before = land.open("s-old");
		await emit(before.pi, "session_start", { type: "session_start", reason: "startup" }, before.ctx);
		await before.bus.join({ label: "tom", wake: true });
		await before.bus.claim(["/repo/src/a.ts"]);
		await reset(before);

		const after = land.open("s-new");
		await emit(after.pi, "session_start", { type: "session_start", reason: "new" }, after.ctx);
		// The channel starts the bus without blocking the reload, so a case that waits for it asks the
		// same start again — memoized, so it is the channel's answer — and joins nothing itself: the join
		// is what the served start owes.
		await after.bus.start(after.ctx);
		const store = createBusStore({ dir: land.dir });
		// The served row is the one a peer addresses, and the successor is on the bus under it.
		expect((await after.bus.status()).me).toEqual({ id: "s-old", label: "tom" });

		// Ten quiet minutes, one beat, and then a peer that acts: its prune is what would take the row,
		// and the claims a card is worked under, from a session whose transcript was merely reset.
		land.advance(SESSION_TTL_MS + 1);
		await land.beat();
		const peer = land.open("s-peer", PID + 1);
		await emit(peer.pi, "session_start", { type: "session_start", reason: "startup" }, peer.ctx);
		await peer.bus.join({ label: "sam", listen: false });

		expect((await store.session("s-old"))?.id).toBe("s-old");
		expect((await store.claims()).map((claim) => [claim.path, claim.owner])).toEqual([["src/a.ts", "s-old"]]);
	});

	test("the mail its inbox was not told about is still the next transcript's to read", async () => {
		const land = world();
		const before = land.open("s-old");
		await emit(before.pi, "session_start", { type: "session_start", reason: "startup" }, before.ctx);
		await before.bus.join({ label: "tom", listen: false });
		await land.beat();
		// A peer's message, landed after the cursor the reset will carry: nothing has been told about it.
		await landMessage(land.dir, busMessage("m9", "s-old", land.now()), land.now());
		await reset(before);

		const after = land.open("s-new");
		await emit(after.pi, "session_start", { type: "session_start", reason: "new" }, after.ctx);
		await after.bus.start(after.ctx);
		const peeked = await after.bus.peek();
		expect([...peeked.unread]).toEqual(["m9"]);
		// The inbox is the served id's, which is why the count is not `unaccounted` mail on a row nobody
		// holds: without the served row this read finds an empty inbox under the new id.
		expect((await after.bus.status()).unaccounted?.messages ?? []).toEqual([]);
	});

	test("a start that minted — no `/new` before it — joins nothing, as it never did", async () => {
		const land = world();
		const first = land.open("s-first");
		await emit(first.pi, "session_start", { type: "session_start", reason: "startup" }, first.ctx);
		// A reader is not a member: starting the bus puts nobody on it, and no beat is armed for a
		// session that has not named itself.
		expect(await createBusStore({ dir: land.dir }).sessions()).toEqual([]);
		expect(land.ticks).toHaveLength(0);
		// Nor is a name published or written onto the transcript: the bar names a session that joined, and
		// nothing else.
		expect(first.pi.getSessionName()).toBeUndefined();
	});
});
