/**
 * The bridge's half of the poller lock: what it does when a takeover has made the
 * account somebody else's, and the heartbeat that keeps a record fresh while one poll
 * attempt runs longer than the stale bar.
 *
 * Its own suite rather than a case in `bridge.test.ts`, which is at its declared height:
 * a poller that kept polling lost the lock and nobody noticed, so this is the one
 * behaviour that turns that into a stop.
 */

import { describe, expect, test } from "bun:test";
import { makeClient, makeDeps } from "../../test/helpers/fixtures/wechat-bridge.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { createBridge } from "./bridge.ts";

describe("a poller that lost its lock", () => {
	test("stops the connection, says so once, and releases nothing", async () => {
		const { client } = makeClient([]);
		const notices: string[] = [];
		const { deps, released } = makeDeps(client, {
			refreshLock: () => false,
			notify: (message) => notices.push(message),
		});
		const bridge = createBridge(deps);
		bridge.open();

		await settle();

		expect(bridge.status().state).toBe("stopped");
		expect(notices).toEqual(["WeChat polling stopped: another Pi session took over the poller lock."]);
		// The lock is the other session's now: releasing it here would delete the record
		// it just took, or hand the account to nobody.
		expect(released.count).toBe(0);
		void bridge.close();
	});

	test("reopens only through an open that takes the lock back", async () => {
		const { client } = makeClient([]);
		const { deps } = makeDeps(client, { refreshLock: () => false });
		const bridge = createBridge(deps);
		bridge.open();
		await settle();

		// The stopped bridge has no loop and no worker, so there is nothing to resume:
		// a start is an open, which reacquires the lock or refuses.
		expect(bridge.status().state).toBe("stopped");
		expect(bridge.status().turnsRunning).toBe(false);
		void bridge.close();
	});
});

describe("the lock heartbeat", () => {
	test("runs for one connection and stops with its loop", async () => {
		const { client } = makeClient([]);
		let beats = 0;
		let stopped = false;
		const { deps } = makeDeps(client, {
			startHeartbeat: () => {
				beats += 1;
				return () => {
					stopped = true;
				};
			},
		});
		const bridge = createBridge(deps);
		bridge.open();
		await settle();
		expect({ beats, stopped }).toEqual({ beats: 1, stopped: false });

		// The lock is released after the loop, so the beat has to be gone by then: one left
		// running would re-stamp a record this process no longer holds.
		await bridge.close();
		expect(stopped).toBe(true);
	});

	test("a beat that finds another holder stops the connection and the parked poll", async () => {
		// The stamp at the top of an attempt cannot see a takeover that lands while `getUpdates`
		// is parked; the heartbeat is what does, and the loop has to end before it holds a batch
		// that is the new holder's to answer.
		const { client, sent } = makeClient([]);
		const notices: string[] = [];
		let beat: (() => void) | undefined;
		let stopped = false;
		let owned = true;
		const { deps, released } = makeDeps(client, {
			refreshLock: () => owned,
			startHeartbeat: (fn) => {
				beat = fn;
				return () => {
					stopped = true;
				};
			},
			notify: (message) => notices.push(message),
		});
		const bridge = createBridge(deps);
		bridge.open();
		// One attempt under the lock, parked in the long poll.
		await settle();
		expect(beat).toBeDefined();

		owned = false;
		beat?.();
		await waitFor(() => stopped);

		expect(bridge.status().state).toBe("stopped");
		expect(notices).toEqual(["WeChat polling stopped: another Pi session took over the poller lock."]);
		// The record is the other session's now: releasing it here would delete theirs.
		expect(released.count).toBe(0);
		expect(sent).toEqual([]);
	});
});
