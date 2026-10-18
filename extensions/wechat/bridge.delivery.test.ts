import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import {
	controllableClient,
	inbound,
	makeClient,
	makeDeps,
	owner,
	updates,
} from "../../test/helpers/fixtures/wechat-bridge.ts";
import { waitFor } from "../../test/helpers/process.ts";
import { createBridge } from "./bridge.ts";
import type { WechatClient } from "./client.ts";
import { DEFAULT_CONFIG } from "./config.ts";

describe("bridge typing indicator", () => {
	test("sets typing before a turn and cancels it before the reply", async () => {
		const { client, typing } = makeClient([updates([inbound("ping")])]);
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		await waitFor(() => typing.length >= 1);
		expect(typing[0]).toEqual({ ilinkUserId: owner, typing: true });

		await bridge.stop(owner);
		await waitFor(() => typing.some((call) => call.typing === false));
		expect(typing.at(-1)).toEqual({ ilinkUserId: owner, typing: false });
		await bridge.close();
	});

	test("does not call sendTyping without a ticket", async () => {
		const { client, typing } = makeClient([updates([inbound("ping")])], { noTicket: true });
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(typing).toEqual([]);
		await bridge.close();
	});
});

describe("bridge remote prompts", () => {
	test("sends a dialog to WeChat and consumes the reply as an answer", async () => {
		const { client, sent, deliver } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel().request({ kind: "select", title: "Pick", options: ["A", "B"] });
		await waitFor(() => sent.length >= 1 && bridge.status().promptPending);
		expect(sent[0]?.text).toContain("Pick");

		deliver(inbound("2"));
		expect(await answer).toEqual({ kind: "value", value: "B" });
		// The reply answered the prompt instead of starting a new turn.
		expect(injected.length).toBe(1);
		await bridge.close();
	});

	test("chunks a long post to the peer", async () => {
		const { client, sent } = controllableClient();
		const { deps, injected } = makeDeps(client, { config: { ...DEFAULT_CONFIG, maxReplyChars: 4 } }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		await bridge.channel().post("abcdefgh");
		// A split reply is numbered so the peer knows how much is still coming.
		expect(sent.map((message) => message.text)).toEqual(["[1/2] abcd", "[2/2] efgh"]);
		await bridge.close();
	});

	test("uploads and sends a file through the channel", async () => {
		const { client, sentFiles } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const path = join(tempDir("wechat-bridge-file-"), "plan.md");
		writeFileSync(path, "plan");
		expect(await bridge.channel().postFile(path, "plan.md")).toBe(true);
		expect(sentFiles[0]).toMatchObject({ to: owner, fileName: "plan.md", len: "4" });
		await bridge.close();
	});

	test("reports a failed message preface once instead of dropping it", async () => {
		const notifications: string[] = [];
		const base = makeClient([updates([inbound("q")])]);
		const client = {
			...base.client,
			sendMessage: async () => ({ ret: -1 }),
		} as unknown as WechatClient;
		const { deps, injected } = makeDeps(client, { notify: (message) => notifications.push(message) }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		// A dialog preface (or the plan digest) that cannot be sent must not look like
		// a preface that never existed: the peer would be left with only the choices.
		await bridge.channel().post("plan digest");
		await bridge.channel().post("second try");
		const failures = notifications.filter((message) => message.includes("message delivery failed"));
		expect(failures).toHaveLength(1);
		await bridge.close();
	});

	test("reports a failed file preface on the terminal", async () => {
		const notifications: string[] = [];
		// `makeClient` has no upload endpoint, so the CDN upload fails like a real one.
		const { client } = makeClient([updates([inbound("q")])]);
		const { deps, injected } = makeDeps(client, { notify: (message) => notifications.push(message) }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const path = join(tempDir("wechat-bridge-file-"), "plan.md");
		writeFileSync(path, "plan");
		expect(await bridge.channel().postFile(path, "plan.md")).toBe(false);
		expect(notifications.some((message) => message.includes("file delivery failed for plan.md"))).toBe(true);
		await bridge.close();
	});

	test("reports the waiting prompt for the control screen", async () => {
		const { client } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel().request({ kind: "select", title: "Pick", options: ["A"] });
		expect(bridge.status().prompt).toMatchObject({ peer: owner, kind: "select", title: "Pick" });
		bridge.channel().cancel();
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(bridge.status().prompt).toBeUndefined();
		await bridge.close();
	});

	test("resolves a pending prompt as cancelled when the bridge closes", async () => {
		const { client, sent } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel().request({ kind: "confirm", title: "Sure?" });
		await waitFor(() => sent.length >= 1 && bridge.status().promptPending);
		await bridge.close();
		expect(await answer).toEqual({ kind: "cancelled" });
	});
});
