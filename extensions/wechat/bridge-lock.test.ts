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

	test("leaves nothing to pause, so the way back is an open that takes the lock", async () => {
		const { client } = makeClient([]);
		const { deps } = makeDeps(client, { refreshLock: () => false });
		const bridge = createBridge(deps);
		bridge.open();
		await settle();

		// Pause and resume belong to a bridge that was polling: this one stopped, so
		// only an open — which reacquires the lock, or refuses — can start it again.
		expect(await bridge.pause()).toBe(false);
		expect(await bridge.resume()).toBe(false);
		void bridge.close();
	});
});
