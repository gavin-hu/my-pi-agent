/**
 * What an interrupted inbound batch leaves behind.
 *
 * A batch is acknowledged only after its messages have reached a peer's session, so
 * this suite drives the two ways an acknowledgement used to run ahead of that: a close
 * during a media download (the message must be read again, not lost), and a poll loop
 * that dies (the connection must stop, not keep a green chip over nothing).
 */

import { describe, expect, test } from "bun:test";
import {
	encrypt,
	inbound,
	inboundImage,
	makeClient,
	makeDeps,
	updates,
} from "../../test/helpers/fixtures/wechat-bridge.ts";
import { waitFor } from "../../test/helpers/process.ts";
import { createBridge } from "./bridge.ts";
import type { WechatState } from "./types.ts";

describe("an interrupted inbound batch", () => {
	test("reads again a message whose download a close interrupted", async () => {
		const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
		const media = { "https://cdn/i": encrypt(plain) };
		const message = { ...inboundImage(), message_id: 42 };
		const first = makeClient([updates([message], "c2")], { media, holdMedia: true });
		const second = makeClient([updates([message], "c2")], { media });
		let built = 0;
		const notices: string[] = [];
		/** What reached the disk: the bridge writes a whole state, so this is the durable copy. */
		let stored: WechatState = { cursor: "" };
		const saved: WechatState[] = [];
		const { deps, peers } = makeDeps(first.client, {
			createClient: () => (built++ === 0 ? first.client : second.client),
			loadState: () => stored,
			saveState: (state) => {
				stored = structuredClone(state);
				saved.push(stored);
			},
			notify: (notice) => notices.push(notice),
		});
		const bridge = createBridge(deps);
		bridge.open();
		await first.mediaDownloading;

		// The download is in flight when the bridge closes; it finishes for nothing.
		const closing = bridge.close();
		first.releaseMedia();
		await closing;

		// Nothing about the message is durable, so nothing has to be undone.
		expect({ state: bridge.status().state, cursor: stored.cursor }).toEqual({ state: "stopped", cursor: "" });
		expect(saved.some((state) => state.seen?.some((entry) => entry.id === 42))).toBe(false);
		expect(notices.join("\n")).toContain("read again on the next start");
		// It never reached a session, which is the point: the next connection gets it.
		expect(peers).toHaveLength(0);

		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);
		expect(peers[0]?.prompts[0]?.images).toHaveLength(1);
		await bridge.close();
	});

	test("stops the connection when the poll loop dies", async () => {
		// The batch was handed over, then the cursor could not be written. Nothing polls
		// any more, so the chip and `/wechat status` have to say so instead of "open".
		const notices: string[] = [];
		const { client } = makeClient([updates([inbound("ping")], "c2")]);
		const { deps } = makeDeps(client, {
			saveState: (state) => {
				if (state.cursor) throw new Error("disk full");
			},
			notify: (notice) => notices.push(notice),
		});
		const bridge = createBridge(deps);
		bridge.open();

		await waitFor(() => bridge.status().state === "stopped");
		expect(notices.join("\n")).toContain("WeChat bridge stopped: disk full");
		await bridge.close();
	});
});
