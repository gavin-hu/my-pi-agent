/**
 * The listening field, end to end: a real join, the record it writes, and the readers a peer
 * reaches it through.
 *
 * Every other case that checks "not listening" builds the roster by hand, which is how the
 * writer's own bug survived them — it wrote nothing for a session that joined disarmed, so
 * three readers keyed off `armed === false` never fired. These cases cross that seam once.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readRoster } from "../../lib/session-roster.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";
import { createBusStore } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

function context(sessionId: string, sessionName: string): ExtensionContext {
	return fakeCtx({ cwd: "/repo", sessionId, sessionName }).ctx as ExtensionContext;
}

/** Two sessions on one bus, neither listening, in a temp directory. */
async function pair(dir: string): Promise<{ frontend: SessionBus; backend: SessionBus }> {
	const make = (): SessionBus =>
		createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			watchMs: 0,
			alive: () => true,
			startTokenFn: () => "started-here",
		});
	const frontend = make();
	const backend = make();
	await frontend.start(context("s1", "frontend"));
	await backend.start(context("s2", "backend"));
	await frontend.join({ listen: false });
	await backend.join({ listen: false });
	return { frontend, backend };
}

describe("the listening field a join writes", () => {
	test("names the peer as not listening in the store, the roster, and the status rows", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { frontend, backend } = await pair(dir);
		// The record on disk, which is what a peer that never asks this session reads.
		expect((await createBusStore({ dir }).session("s2"))?.watching).toEqual({ armed: false, wake: false });
		// The page and `/team` share one roster read, and mark a live peer only on `armed === false`.
		const roster = await readRoster(dir);
		expect(roster?.find((session) => session.id === "s2")?.watching).toEqual({ armed: false, wake: false });
		// `listPeers` maps these rows, and publishes `listening` only where the field is.
		const seen = (await frontend.status()).sessions.find((session) => session.id === "s2");
		expect(seen?.watching).toEqual({ armed: false, wake: false });
		await frontend.stop();
		await backend.stop();
	});

	test("reads the other way once the watch is armed, so the field is a fact and not a default", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const { frontend, backend } = await pair(dir);
		await backend.join({});
		expect((await createBusStore({ dir }).session("s2"))?.watching).toEqual({ armed: true, wake: false });
		await backend.join({ wake: true });
		expect((await readRoster(dir))?.find((session) => session.id === "s2")?.watching).toEqual({
			armed: true,
			wake: true,
		});
		await frontend.stop();
		await backend.stop();
	});
});
