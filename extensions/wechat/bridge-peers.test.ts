/**
 * Two peers' turns at once, and what a close says to a peer whose turn it cut off:
 * each running peer owns its dialog, and an abandoned answer is announced once.
 */

import { describe, expect, test } from "bun:test";
import { controllableClient, inbound, makeDeps, owner } from "../../test/helpers/fixtures/wechat-bridge.ts";
import { waitFor } from "../../test/helpers/process.ts";
import { createBridge } from "./bridge.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import type { WechatClient } from "./transport/client.ts";

describe("two peers at once", () => {
	const OTHER = "friend@im.wechat";

	/** Open a bridge with the owner's turn and one other peer's turn both in flight. */
	async function twoPeers() {
		const { client, sent, deliver } = controllableClient();
		const { deps, injected } = makeDeps(
			client,
			{ config: { ...DEFAULT_CONFIG, allowedPeers: [OTHER] } },
			{ hold: true },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		deliver(inbound("hello", OTHER));
		await waitFor(() => injected.length === 2);
		return { bridge, sent };
	}

	test("gives each peer's dialog its own owner", async () => {
		const { bridge, sent } = await twoPeers();

		const mine = bridge.channel(owner).request({ kind: "confirm", title: "For the owner?" });
		const theirs = bridge.channel(OTHER).request({ kind: "confirm", title: "For the friend?" });
		await waitFor(() => bridge.status().prompts.length === 2);
		// Each question went to the phone that was asked.
		await waitFor(() => sent.filter((message) => message.text.includes("For the")).length === 2);
		expect(sent.some((message) => message.to === owner && message.text.includes("For the owner?"))).toBe(true);
		expect(sent.some((message) => message.to === OTHER && message.text.includes("For the friend?"))).toBe(true);

		// Each reply answers its own peer's prompt and leaves the other waiting.
		expect(bridge.channel(owner).handleInbound("yes")).toBe(true);
		expect(await mine).toEqual({ kind: "confirmed", confirmed: true });
		expect(bridge.status().prompts.map((prompt) => prompt.peer)).toEqual([OTHER]);

		expect(bridge.channel(OTHER).handleInbound("no")).toBe(true);
		expect(await theirs).toEqual({ kind: "confirmed", confirmed: false });
		expect(bridge.status().prompts).toEqual([]);
		await bridge.close();
	});

	test("aborting one peer's dialog leaves the other's waiting", async () => {
		const { bridge } = await twoPeers();
		const controller = new AbortController();
		const mine = bridge.channel(owner).request({ kind: "confirm", title: "For the owner?" }, controller.signal);
		const theirs = bridge.channel(OTHER).request({ kind: "select", title: "For the friend?", options: ["A"] });
		await waitFor(() => bridge.status().prompts.length === 2);

		controller.abort();
		expect(await mine).toEqual({ kind: "cancelled" });
		expect(bridge.channel(OTHER).hasPending()).toBe(true);
		expect(bridge.channel(OTHER).handleInbound("1")).toBe(true);
		expect(await theirs).toEqual({ kind: "value", value: "A" });
		await bridge.close();
	});
});

describe("abandoned turns", () => {
	const NOTICE = "The session stopped before this answer finished — send it again when it's back.";

	test("tells the peer when a close cuts its turn off", async () => {
		// `respectSignal` makes the transport refuse an already-aborted send, as `fetch`
		// does, so a notice that inherited the poll's controller would be lost here.
		const { client, sent } = controllableClient({ respectSignal: true });
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		await bridge.close();
		expect(sent.map((message) => message.text)).toEqual([NOTICE]);
	});

	test("says nothing once the answer has arrived", async () => {
		const { client, sent } = controllableClient({ respectSignal: true });
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		await waitFor(() => sent.length === 1);

		await bridge.close();
		expect(sent.map((message) => message.text)).toEqual(["pong"]);
	});

	test("reports an abandon notice the transport could not deliver, once", async () => {
		const { client } = controllableClient();
		const notices: string[] = [];
		const failing = {
			...client,
			sendMessage: async () => {
				throw new Error("network down");
			},
		} as unknown as WechatClient;
		const { deps, injected } = makeDeps(failing, { notify: (message) => notices.push(message) }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		await bridge.close();
		expect(notices.filter((message) => message.includes("network down"))).toHaveLength(1);
	});
});
