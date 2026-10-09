import { describe, expect, test } from "bun:test";
import { INTERACTION_OTHER_LABEL, type InteractionRequest } from "../../lib/interaction.ts";
import { createWechatInteractionChannel, type WechatInteractionDeps } from "./interaction.ts";

const SELECT: InteractionRequest = { kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] };
const INPUT: InteractionRequest = { kind: "input", title: "Name" };
const CONFIRM: InteractionRequest = { kind: "confirm", title: "Sure?" };

function setup(initialPeer: string | undefined = "owner") {
	const sent: string[] = [];
	let peer: string | undefined = initialPeer;
	const deps: WechatInteractionDeps = {
		send: async (text) => {
			sent.push(text);
			return true;
		},
		activePeer: () => peer,
	};
	const channel = createWechatInteractionChannel(deps);
	return { channel, sent, setPeer: (value: string | undefined) => (peer = value) };
}

describe("isActive", () => {
	test("follows the active peer", () => {
		const { channel, setPeer } = setup();
		expect(channel.isActive()).toBe(true);
		setPeer(undefined);
		expect(channel.isActive()).toBe(false);
	});
});

describe("hasPending", () => {
	test("tracks whether a reply is awaited", async () => {
		const { channel } = setup();
		expect(channel.hasPending()).toBe(false);
		const answer = channel.request(SELECT);
		expect(channel.hasPending()).toBe(true);
		channel.handleInbound("owner", "1");
		await answer;
		expect(channel.hasPending()).toBe(false);
	});
});

describe("request", () => {
	test("sends the prompt and resolves on a matching reply", async () => {
		const { channel, sent } = setup();
		const answer = channel.request(SELECT);
		expect(sent).toHaveLength(1);
		expect(channel.handleInbound("owner", "2")).toBe(true);
		expect(await answer).toEqual({ kind: "value", value: "B" });
	});

	test("cancels immediately without an active peer", async () => {
		const { channel, setPeer } = setup();
		setPeer(undefined);
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
	});

	test("cancels a concurrent second request", async () => {
		const { channel } = setup();
		const first = channel.request(SELECT);
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
		channel.handleInbound("owner", "1");
		await first;
	});

	test("cancels on abort", async () => {
		const { channel } = setup();
		const controller = new AbortController();
		const answer = channel.request(SELECT, controller.signal);
		controller.abort();
		expect(await answer).toEqual({ kind: "cancelled" });
	});

	test("cancels when the send fails", async () => {
		const deps: WechatInteractionDeps = { send: async () => false, activePeer: () => "owner" };
		const channel = createWechatInteractionChannel(deps);
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
	});
});

describe("handleInbound", () => {
	test("ignores a reply from another peer", async () => {
		const { channel } = setup();
		const answer = channel.request(SELECT);
		expect(channel.handleInbound("stranger", "1")).toBe(false);
		expect(channel.handleInbound("owner", "1")).toBe(true);
		await answer;
	});

	test("ignores an inbound message with no pending prompt", () => {
		const { channel } = setup();
		expect(channel.handleInbound("owner", "hi")).toBe(false);
	});

	test("re-prompts on a retry and keeps waiting", async () => {
		const { channel, sent } = setup();
		const answer = channel.request(CONFIRM);
		expect(channel.handleInbound("owner", "maybe")).toBe(true);
		expect(sent).toHaveLength(2);
		expect(channel.handleInbound("owner", "是")).toBe(true);
		expect(await answer).toEqual({ kind: "confirmed", confirmed: true });
	});

	test("maps a cancel word to cancelled", async () => {
		const { channel } = setup();
		const answer = channel.request(SELECT);
		channel.handleInbound("owner", "取消");
		expect(await answer).toEqual({ kind: "cancelled" });
	});
});

describe("other flow", () => {
	test("select free text becomes Other and the next input returns it", async () => {
		const { channel, sent } = setup();
		const select = channel.request(SELECT);
		channel.handleInbound("owner", "custom value");
		expect(await select).toEqual({ kind: "value", value: INTERACTION_OTHER_LABEL });

		const before = sent.length;
		const input = await channel.request(INPUT);
		expect(input).toEqual({ kind: "value", value: "custom value" });
		expect(sent.length).toBe(before);
	});
});

describe("reset", () => {
	test("resolves a pending prompt as cancelled", async () => {
		const { channel } = setup();
		const answer = channel.request(SELECT);
		channel.reset();
		expect(await answer).toEqual({ kind: "cancelled" });
	});

	test("clears the other stash", async () => {
		const { channel } = setup();
		const select = channel.request(SELECT);
		channel.handleInbound("owner", "custom value");
		await select;
		channel.reset();
		// The stash is gone, so the next input is a fresh prompt rather than a replay.
		const input = channel.request(INPUT);
		expect(channel.handleInbound("owner", "typed")).toBe(true);
		expect(await input).toEqual({ kind: "value", value: "typed" });
	});
});
