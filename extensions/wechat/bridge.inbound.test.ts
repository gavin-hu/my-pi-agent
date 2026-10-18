import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import {
	controllableClient,
	encrypt,
	fakeTimers,
	inbound,
	inboundFile,
	inboundImage,
	inboundImageWithKey,
	inboundWithId,
	makeClient,
	makeDeps,
	owner,
	updates,
} from "../../test/helpers/fixtures/wechat-bridge.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { createBridge } from "./bridge.ts";
import type { WechatClient } from "./client.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import type { BotCredentials, UpdatesResponse, WechatState } from "./types.ts";

describe("bridge inbound guard", () => {
	test("answers a replayed message id once", async () => {
		const { client } = makeClient([updates([inboundWithId("hi", 42), inboundWithId("hi", 42)])]);
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		await settle();
		expect(injected).toHaveLength(1);
		await bridge.close();
	});

	test("remembers the id across a reopen", async () => {
		const first = makeClient([updates([inboundWithId("hi", 7)])]);
		let saved: WechatState | undefined;
		const { deps, injected } = makeDeps(
			first.client,
			{
				saveState: (state) => {
					saved = structuredClone(state);
				},
			},
			{ hold: true },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		await bridge.close();

		const second = makeClient([updates([inboundWithId("hi", 7)])]);
		const reopened = makeDeps(
			second.client,
			{ loadState: () => structuredClone(saved as WechatState) },
			{ hold: true },
		);
		const bridge2 = createBridge(reopened.deps);
		bridge2.open();
		await settle();
		await settle();
		// The replay died on the persisted id, so no peer session was opened.
		expect(reopened.injected).toEqual([]);
		await bridge2.close();
	});

	test("truncates an oversized message and marks it", async () => {
		const long = "x".repeat(1200);
		const { client } = makeClient([updates([inbound(long)])]);
		const notifications: string[] = [];
		const { deps, injected } = makeDeps(
			client,
			{
				config: { ...DEFAULT_CONFIG, maxInboundChars: 1000 },
				notify: (message) => notifications.push(message),
			},
			{ hold: true },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toContain("[WeChat message truncated: showing 1000 of 1200 characters]");
		expect(injected[0].startsWith("x".repeat(1000))).toBe(true);
		expect(notifications.some((message) => message.includes("truncated to 1000 characters"))).toBe(true);
		await bridge.close();
	});
});

describe("bridge media", () => {
	test("downloads, decrypts, and injects an image as content", async () => {
		const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
		const { client } = makeClient([updates([inboundImage()])], { media: { "https://cdn/i": encrypt(plain) } });
		const { deps, peers } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);
		expect(peers[0]?.prompts[0]).toEqual({
			text: "",
			images: [{ type: "image", data: plain.toString("base64"), mimeType: "image/png" }],
		});
		await bridge.close();
	});

	test("saves an inbound file and references its path", async () => {
		const plain = Buffer.from("file contents");
		const mediaDir = tempDir("wechat-files-");
		const { client } = makeClient([updates([inboundFile()])], { media: { "https://cdn/f": encrypt(plain) } });
		const { deps, injected } = makeDeps(client, { mediaDir: () => mediaDir });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		const prefix = "[WeChat file: notes.txt saved to ";
		expect(injected[0]?.startsWith(prefix)).toBe(true);
		const path = (injected[0] ?? "").slice(prefix.length).replace(/\]$/, "");
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path)).toEqual(plain);
		await bridge.close();
	});

	test("keeps the text turn when media decryption fails", async () => {
		const bad = inbound("look");
		bad.item_list = [...(bad.item_list ?? []), ...(inboundImageWithKey(owner, "0".repeat(32)).item_list ?? [])];
		const { client } = makeClient([updates([bad])], { media: { "https://cdn/i": new Uint8Array([1, 2, 3]) } });
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		// The model is told the image was skipped instead of assuming it saw it.
		expect(injected[0]).toBe("look\n[WeChat media skipped: 1]");
		await waitFor(() => bridge.status().mediaDropped === 1);
		await bridge.close();
	});

	test("drops media over the size cap", async () => {
		const big = inbound("big");
		big.item_list = [...(big.item_list ?? []), ...(inboundImage().item_list ?? [])];
		const { client } = makeClient([updates([big])], { media: { "https://cdn/i": new Uint8Array(10) } });
		const { deps, injected } = makeDeps(client, { config: { ...DEFAULT_CONFIG, maxMediaBytes: 4 } });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("big\n[WeChat media skipped: 1]");
		await waitFor(() => bridge.status().mediaDropped === 1);
		await bridge.close();
	});

	test("answers a peer whose only attachment could not be read", async () => {
		const { client, sent } = makeClient([updates([inboundImage()])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);

		expect(sent[0]?.text).toBe("Couldn't open 1 attachment(s) — please resend or describe it.");
		// Nothing readable means no turn: the model is not asked about a photo it
		// never received.
		expect(injected).toEqual([]);
		await bridge.close();
	});

	test("opens the reply with the media notice", async () => {
		const mixed = inbound("look");
		mixed.item_list = [...(mixed.item_list ?? []), ...(inboundImage().item_list ?? [])];
		const { client, sent } = makeClient([updates([mixed])]);
		const { deps, peers } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);

		peers[0]?.release("it is a cat");
		await waitFor(() => sent.length === 1);
		// One bubble: the failed attachment rides on the answer.
		expect(sent[0]?.text).toBe("Couldn't open 1 attachment(s) — please resend or describe it.\n\nit is a cat");
		await bridge.close();
	});

	test("answers a voice note the server gave no transcript for", async () => {
		const voice = inbound("");
		voice.item_list = [{ type: 3, voice_item: { media: { full_url: "https://cdn/v" } } }];
		const { client, sent } = makeClient([updates([voice])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);

		expect(sent[0]?.text).toContain("Voice without a transcript and video aren't supported");
		expect(injected).toEqual([]);
		await bridge.close();
	});

	test("answers a video with a notice instead of silence", async () => {
		const video = inbound("");
		video.item_list = [{ type: 5, video_item: { media: { full_url: "https://cdn/v" } } }];
		const { client, sent } = makeClient([updates([video])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);

		expect(sent[0]?.text).toContain("aren't supported");
		expect(injected).toEqual([]);
		await bridge.close();
	});
});

describe("bridge peer feedback", () => {
	test("reports how much of a split reply went out when a chunk fails", async () => {
		const sent: string[] = [];
		const notifications: string[] = [];
		let calls = 0;
		const script: UpdatesResponse[] = [updates([inbound("ping")])];
		const client = {
			getUpdates: async (_account: BotCredentials, _cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
				const next = script.shift();
				if (next) return next;
				await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
				throw new Error("aborted");
			},
			sendMessage: async (_account: BotCredentials, args: { text: string }) => {
				calls += 1;
				if (calls === 2) throw new Error("socket hang up");
				sent.push(args.text);
				return { ret: 0 };
			},
			getConfig: async () => ({ ret: 0 }),
			sendTyping: async () => ({ ret: 0 }),
			downloadCdn: async () => new Uint8Array(),
		} as unknown as WechatClient;
		const { deps, peers } = makeDeps(
			client,
			{
				config: { ...DEFAULT_CONFIG, maxReplyChars: 4 },
				notify: (message) => notifications.push(message),
			},
			{ hold: true },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);

		peers[0]?.release("abcdefgh");
		await waitFor(() => notifications.length === 1);

		expect(sent).toEqual(["[1/2] abcd"]);
		expect(notifications[0]).toContain("after 1 of 2 parts were sent");
		await bridge.close();
	});

	test("acknowledges a peer waiting on another conversation, once, then says why", async () => {
		const timers = fakeTimers();
		const other = "friend@im.wechat";
		const { client, sent } = makeClient([updates([inbound("mine"), inbound("theirs", other)])]);
		const { deps, injected } = makeDeps(
			client,
			{ config: { ...DEFAULT_CONFIG, allowedPeers: [other] }, armTimer: timers.arm },
			{ hold: true, answers: ["for me", "for them"] },
		);
		const bridge = createBridge(deps);
		bridge.open();
		// One turn at a time: the second peer waits for a slot.
		await waitFor(() => bridge.status().queued === 1);
		expect(injected).toHaveLength(1);

		timers.fire();
		await settle();
		expect(sent.some((message) => message.text === "Got it — working on it.")).toBe(true);

		// A minute later it is still waiting: say so once, and only once.
		timers.fire();
		await settle();
		const busy = () => sent.filter((message) => message.text.includes("queued behind another conversation"));
		expect(busy()).toHaveLength(1);
		timers.fire();
		await settle();
		expect(busy()).toHaveLength(1);
		await bridge.close();
	});

	test("does not acknowledge a wait that ends at once", async () => {
		const timers = fakeTimers();
		const other = "friend@im.wechat";
		const { client, sent } = makeClient([updates([inbound("mine"), inbound("theirs", other)])]);
		const { deps, peers } = makeDeps(
			client,
			{ config: { ...DEFAULT_CONFIG, allowedPeers: [other] }, armTimer: timers.arm },
			{ hold: true, answers: ["for me", "for them"] },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().queued === 1);

		// The first turn ends before the 4 s timer: the second starts, no ack.
		peers[0]?.release("for me");
		await waitFor(() => sent.some((message) => message.text === "for me"));
		timers.fire();
		await settle();
		// No acknowledgement: the second turn started before the timer mattered.
		expect(sent.some((message) => message.text === "Got it — working on it.")).toBe(false);
		await bridge.close();
	});

	test("starts the typing indicator for a message that is waiting", async () => {
		const timers = fakeTimers();
		const other = "friend@im.wechat";
		const { client, typing } = makeClient([updates([inbound("mine"), inbound("theirs", other)])]);
		const { deps } = makeDeps(
			client,
			{ config: { ...DEFAULT_CONFIG, allowedPeers: [other] }, armTimer: timers.arm },
			{ hold: true, answers: ["for me", "for them"] },
		);
		const bridge = createBridge(deps);
		bridge.open();

		await waitFor(() => typing.some((call) => call.ilinkUserId === other));
		expect(typing.some((call) => call.typing === true)).toBe(true);
		// The indicator is refreshed while the peer waits, instead of lapsing.
		const before = typing.length;
		timers.fire();
		await waitFor(() => typing.length > before);
		expect(typing.at(-1)?.typing).toBe(true);
		await bridge.close();
	});

	test("answers in the peer's language", async () => {
		const { client, sent } = makeClient([updates([inbound("你好")])]);
		const { deps } = makeDeps(client, {}, { answers: [""] });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);
		// A turn with no text says so in the peer's language, not in English.
		expect(sent[0]?.text).toBe("这条处理完了，但没有文字输出。");
		await bridge.close();
	});

	test("refuses a queued message beyond the cap with one notice", async () => {
		const other = "friend@im.wechat";
		const burst = [inbound("held"), ...Array.from({ length: 10 }, (_unused, index) => inbound(`m${index}`, other))];
		const { client, sent } = makeClient([updates(burst)]);
		const { deps } = makeDeps(client, { config: { ...DEFAULT_CONFIG, allowedPeers: [other] } }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);

		expect(sent[0]?.text).toBe("Too many messages queued — please wait a moment.");
		expect(bridge.status().queued).toBe(8);
		await bridge.close();
	});

	test("refuses a turn beyond the hourly cap", async () => {
		const { client, sent } = makeClient([updates([inbound("one"), inbound("two")])]);
		const { deps } = makeDeps(client, { config: { ...DEFAULT_CONFIG, maxTurnsPerHour: 1 } }, { answers: ["pong"] });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 2);
		expect(sent.some((message) => message.text === "pong")).toBe(true);
		const limits = sent.filter((message) => message.text.includes("message limit"));
		expect(limits).toHaveLength(1);
		await bridge.close();
	});

	test("declines /new while a run is in flight", async () => {
		const { client, sent, deliver } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		deliver(inbound("/new"));
		await waitFor(() => sent.length >= 1);
		expect(sent[0]?.text).toContain("send /new again");
		// The session was not replaced under the run.
		expect(bridge.reset(owner)).toBe(false);
		await bridge.close();
	});

	test("starts a fresh conversation on /new when nothing is running", async () => {
		const { client, sent } = makeClient([updates([inbound("/new")])]);
		const { deps } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);

		expect(sent[0]?.text).toContain("Starting a new session");
		expect(bridge.peerState(owner)).toEqual({ status: "idle", queued: 0 });
		await bridge.close();
	});

	test("does not say still-working while a dialog is waiting for an answer", async () => {
		const timers = fakeTimers();
		const { client, sent } = makeClient([updates([inbound("slow")])]);
		const { deps, peers } = makeDeps(client, { armTimer: timers.arm }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);

		// The turn asks the peer a question and waits for the answer.
		const answer = bridge.channel().request({ kind: "confirm", title: "Sure?" });
		await waitFor(() => bridge.status().promptPending);
		timers.fire();
		await settle();
		// The prompt nudges for itself; "still working" would be a second bubble.
		const texts = sent.map((message) => message.text).join("\n");
		expect(texts).not.toContain("Still working");
		expect(texts).toContain("Sure?");

		bridge.channel().handleInbound(owner, "yes");
		await answer;
		await bridge.close();
	});

	test("says the running turn is still going after a while", async () => {
		const timers = fakeTimers();
		const { client, sent } = makeClient([updates([inbound("slow")])]);
		const { deps, injected } = makeDeps(client, { armTimer: timers.arm }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		timers.fire();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toContain("Still working");

		// One line per slow turn, not a heartbeat.
		timers.fire();
		expect(sent).toHaveLength(1);
		await bridge.close();
	});
});
