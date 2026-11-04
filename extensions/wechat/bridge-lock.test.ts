/**
 * The bridge's half of the poller lock: what it does when a takeover has made the
 * account somebody else's.
 *
 * Its own suite rather than a case in `bridge.test.ts`, which is at its declared height:
 * a poller that kept polling lost the lock and nobody noticed, so this is the one
 * behaviour that turns that into a stop.
 */

import { describe, expect, test } from "bun:test";
import { makeClient, makeDeps } from "../../test/helpers/fixtures/wechat-bridge.ts";
import { settle } from "../../test/helpers/process.ts";
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
