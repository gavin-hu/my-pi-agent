import { describe, expect, test } from "bun:test";
import { INTERACTION_OTHER_LABEL } from "../../../lib/interaction.ts";
import { settle } from "../../../test/helpers/process.ts";
import { createPeerChannels } from "./channels.ts";

const ALICE = "alice@im.wechat";
const BOB = "bob@im.wechat";

/** The registry over recording senders, a mutable running set, and a fake clock. */
function channelsOver(options: { running?: string[]; language?: "en" | "zh" } = {}) {
	const sent: Array<{ peer: string; text: string }> = [];
	const files: Array<{ peer: string; name: string }> = [];
	const flushed: string[] = [];
	const running = new Set(options.running ?? [ALICE, BOB]);
	const channels = createPeerChannels({
		flush: async (peer) => {
			flushed.push(peer);
		},
		send: async (peer, text) => {
			sent.push({ peer, text });
			return true;
		},
		sendFile: async (peer, _path, name) => {
			files.push({ peer, name });
			return true;
		},
		active: (peer) => running.has(peer),
		language: () => options.language ?? "en",
		now: () => 1_000,
	});
	const stop = (peer: string): void => {
		running.delete(peer);
	};
	return { channels, sent, files, flushed, stop };
}

describe("peer channels", () => {
	test("builds one channel per peer, and the same one on every ask", () => {
		const { channels } = channelsOver();
		expect(channels.for(ALICE)).toBe(channels.for(ALICE));
		expect(channels.for(ALICE)).not.toBe(channels.for(BOB));
		expect(channels.prompts()).toEqual([]);
	});

	test("routes a reply to the peer's own prompt", async () => {
		const { channels } = channelsOver();
		const alice = channels.for(ALICE).request({ kind: "select", title: "Pick", options: ["A"] });
		const bob = channels.for(BOB).request({ kind: "confirm", title: "Sure?" });
		await settle();
		expect(
			channels
				.prompts()
				.map((prompt) => prompt.peer)
				.sort(),
		).toEqual([ALICE, BOB]);

		// Each answer resolves its own peer's question, and only that one.
		expect(channels.handleInbound(ALICE, "1")).toBe(true);
		expect(await alice).toEqual({ kind: "value", value: "A" });
		expect(channels.pendingFor(BOB)?.title).toBe("Sure?");
		expect(channels.handleInbound(BOB, "yes")).toBe(true);
		expect(await bob).toEqual({ kind: "confirmed", confirmed: true });
		expect(channels.hasPending()).toBe(false);
	});

	test("a peer with no prompt cannot answer another peer's", async () => {
		const { channels } = channelsOver();
		const alice = channels.for(ALICE).request({ kind: "confirm", title: "Sure?" });
		// Bob has no channel yet, so his message creates none and answers nothing.
		expect(channels.handleInbound(BOB, "yes")).toBe(false);
		expect(channels.hasPending(BOB)).toBe(false);
		expect(channels.hasPending(ALICE)).toBe(true);
		expect(channels.handleInbound(ALICE, "yes")).toBe(true);
		expect(await alice).toEqual({ kind: "confirmed", confirmed: true });
	});

	test("keeps each peer's free text to itself", async () => {
		const { channels } = channelsOver();
		const aliceSelect = channels.for(ALICE).request({
			kind: "select",
			title: "Pick",
			options: ["A", INTERACTION_OTHER_LABEL],
		});
		channels.handleInbound(ALICE, "alice typed this");
		await aliceSelect;

		// Bob's next input reads what Bob types; alice's stash is not reachable.
		const bobInput = channels.for(BOB).request({ kind: "input", title: "Name" });
		channels.handleInbound(BOB, "bob typed this");
		expect(await bobInput).toEqual({ kind: "value", value: "bob typed this" });
		expect(await channels.for(ALICE).request({ kind: "input", title: "Name" })).toEqual({
			kind: "value",
			value: "alice typed this",
		});
	});

	test("asks through the peer's own turn, flushing buffered text first", async () => {
		const { channels, sent, flushed } = channelsOver();
		const answer = channels.for(ALICE).request({ kind: "confirm", title: "Sure?" });
		// The flush and the send happen behind the returned promise.
		await settle();
		expect(flushed).toEqual([ALICE]);
		expect(sent[0]?.peer).toBe(ALICE);
		channels.handleInbound(ALICE, "no");
		expect(await answer).toEqual({ kind: "confirmed", confirmed: false });
	});

	test("cancels every prompt on a pause, telling each peer once", async () => {
		const { channels, sent } = channelsOver();
		const alice = channels.for(ALICE).request({ kind: "confirm", title: "Sure?" });
		const bob = channels.for(BOB).request({ kind: "confirm", title: "Ready?" });

		await channels.cancelAll();
		expect(await alice).toEqual({ kind: "cancelled" });
		expect(await bob).toEqual({ kind: "cancelled" });
		expect(sent.filter((message) => message.text.includes("withdrawn"))).toHaveLength(2);
	});

	test("drops every channel on a reset, silently", async () => {
		const { channels, sent } = channelsOver();
		const waiting = channels.for(ALICE).request({ kind: "confirm", title: "Sure?" });
		channels.reset();
		expect(await waiting).toEqual({ kind: "cancelled" });
		// `reset` is the cleanup path: no withdrawal line, and the channel is rebuilt.
		expect(sent.some((message) => message.text.includes("withdrawn"))).toBe(false);
		expect(channels.prompts()).toEqual([]);
		expect(channels.for(ALICE)).not.toBe(channels.for(BOB));
	});

	test("refuses a prompt for a peer whose turn is not running", async () => {
		const { channels, sent } = channelsOver({ running: [] });
		expect(await channels.for(ALICE).request({ kind: "confirm", title: "Sure?" })).toEqual({ kind: "cancelled" });
		expect(sent).toEqual([]);
	});
});
