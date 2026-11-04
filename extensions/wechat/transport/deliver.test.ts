/**
 * The outbound text split: every numbered part is a message the peer actually
 * receives, so the marker has to fit inside `maxReplyChars` with the text.
 *
 * The limit is a message limit, not a text limit — a part that arrives at
 * `maxReplyChars + 6` is a part the transport is entitled to reject.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { settle } from "../../../test/helpers/process.ts";
import { tempDir } from "../../../test/helpers/env.ts";
import type { WechatClient } from "./client.ts";
import { createDeliverer, numberedChunks, type DeliveryDeps } from "./deliver.ts";
import type { BotCredentials } from "../types.ts";

const ACCOUNT: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "a",
	createdAt: 0,
};

/** The deliverer over a client that records each body instead of sending it. */
function deliverer(maxReplyChars: number) {
	const sent: string[] = [];
	const deps: DeliveryDeps = {
		client: () =>
			({
				sendMessage: async (_account: BotCredentials, args: { text: string }) => {
					sent.push(args.text);
					return { ret: 0 };
				},
			}) as unknown as WechatClient,
		account: () => ACCOUNT,
		maxReplyChars: () => maxReplyChars,
		cdnBaseUrl: "https://cdn.invalid",
		maxMediaBytes: 1024,
		notify: () => {},
		onExpired: () => {},
		forgetToken: () => {},
	};
	return { deliverer: createDeliverer(deps), sent };
}

/** A body's length in code points, which is what the limit counts. */
function width(text: string): number {
	return [...text].length;
}

/**
 * A deliverer over a client whose text sends fail on demand, with the side effects
 * the notice and the doctor both read recorded instead of applied.
 */
function notifier() {
	const notes: string[] = [];
	const errors: string[] = [];
	const forgotten: string[] = [];
	let textFails = false;
	const client = {
		sendMessage: async (_account: BotCredentials, _args: unknown, signal?: AbortSignal) => {
			if (signal?.aborted) throw new Error("aborted");
			if (textFails) throw new Error("network down");
			return { ret: 0 };
		},
		getUploadUrl: async () => ({ uploadParam: "up" }),
		uploadCdn: async () => "dl",
		sendImageMessage: async () => ({ ret: 0 }),
	} as unknown as WechatClient;
	const deliverer = createDeliverer({
		client: () => client,
		account: () => ACCOUNT,
		maxReplyChars: () => 1000,
		cdnBaseUrl: "https://cdn/c2c",
		maxMediaBytes: 1024,
		notify: (message) => notes.push(message),
		onExpired: () => {},
		forgetToken: (peer) => forgotten.push(peer),
		onSendError: (message) => errors.push(message),
	});
	return {
		deliverer,
		notes,
		errors,
		forgotten,
		failText: (value: boolean) => {
			textFails = value;
		},
	};
}

/** A temp image the upload path accepts. */
function plot(): string {
	const path = join(tempDir("wechat-image-"), "plot.png");
	writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), Buffer.from("body")]));
	return path;
}

describe("numbered parts", () => {
	test("every delivered part fits the limit, marker included", async () => {
		const { deliverer: send, sent } = deliverer(20);
		expect(await send.reply({ peer: "alice@im.wechat" }, "abcdefghij".repeat(4))).toBe(true);

		expect(sent).toEqual(["[1/3] abcdefghijabcd", "[2/3] efghijabcdefgh", "[3/3] ijabcdefghij"]);
		for (const body of sent) expect(width(body)).toBeLessThanOrEqual(20);
	});

	test("a two-digit part count reserves the wider marker", async () => {
		const { deliverer: send, sent } = deliverer(12);
		expect(await send.reply({ peer: "alice@im.wechat" }, "a".repeat(100))).toBe(true);

		expect(sent.length).toBeGreaterThan(1);
		// `[10/17] ` is wider than `[1/9] `: the width is reserved before the cut.
		for (const body of sent) expect(width(body)).toBeLessThanOrEqual(12);
	});

	test("a limit too small for its own marker keeps one code point per part", () => {
		// Documented floor: the marker alone exceeds the limit, so the text is cut to
		// the smallest message that can carry a number without losing a character.
		const chunks = numberedChunks("abcdefgh", 1);
		expect(chunks).toHaveLength(8);
		expect(chunks.every((chunk) => width(chunk) === 1)).toBe(true);
	});

	test("the floor is the marker its own count needs, not just a tiny limit", () => {
		// Seven parts would fit a seven-point limit, but 100 parts need `[1/100] `:
		// the room floors at one code point and the marker overflows. Nothing is lost.
		const chunks = numberedChunks("a".repeat(100), 7);
		expect(chunks).toHaveLength(100);
		expect(chunks.join("")).toBe("a".repeat(100));
		expect(chunks.every((chunk) => width(chunk) === 1)).toBe(true);
	});

	test("a reply that fits is one unnumbered message", () => {
		expect(numberedChunks("abcdefgh", 12)).toEqual(["abcdefgh"]);
	});
});

describe("failure reporting", () => {
	test("a delivered attachment ends the outage a failed reply started", async () => {
		const h = notifier();
		h.failText(true);
		await h.deliverer.reply({ peer: "alice@im.wechat" }, "one");
		await h.deliverer.reply({ peer: "alice@im.wechat" }, "two");
		// One notice per outage: nothing got through to that peer.
		expect(h.notes).toHaveLength(1);

		h.failText(false);
		expect(await h.deliverer.image({ peer: "alice@im.wechat" }, plot())).toBe(true);

		// The peer just received a picture, so the next failure is news again.
		h.failText(true);
		await h.deliverer.reply({ peer: "alice@im.wechat" }, "three");
		expect(h.notes).toHaveLength(2);
		expect(h.notes[1]).toContain("reply failed");
	});

	test("a close during a proactive send records no failure", async () => {
		const h = notifier();
		const controller = new AbortController();
		controller.abort();

		const result = await h.deliverer.toOwner("owner@im.wechat", "ctx", "hi", controller.signal);

		expect(result.ok).toBe(false);
		// Nothing was refused: the token is still good and the abort is not an outage.
		expect(h.errors).toEqual([]);
		expect(h.forgotten).toEqual([]);
	});

	test("a proactive send that fails without an abort is recorded", async () => {
		const h = notifier();
		h.failText(true);

		const result = await h.deliverer.toOwner("owner@im.wechat", "ctx", "hi");

		expect(result).toEqual({ ok: false, error: "network down" });
		expect(h.errors).toEqual(["network down"]);
		expect(h.forgotten).toEqual(["owner@im.wechat"]);
	});
});

describe("deliverer ordering", () => {
	test("serializes a reply and a prompt per peer", async () => {
		const order: string[] = [];
		let release: (() => void) | undefined;
		const client = {
			sendMessage: async (_account: unknown, args: { text: string }) => {
				if (args.text === "one") await new Promise<void>((resolve) => (release = resolve));
				order.push(args.text);
				return { ret: 0 };
			},
		} as unknown as WechatClient;
		const deliverer = createDeliverer({
			client: () => client,
			account: () => ACCOUNT,
			maxReplyChars: () => 1000,
			cdnBaseUrl: "",
			maxMediaBytes: 1024,
			notify: () => {},
			onExpired: () => {},
			forgetToken: () => {},
		});
		const first = deliverer.reply({ peer: "alice" }, "one");
		const second = deliverer.prompt({ peer: "alice" }, "two");
		await settle();
		expect(order).toEqual([]);
		release?.();
		await Promise.all([first, second]);
		expect(order).toEqual(["one", "two"]);
	});

	test("does not let one peer block another", async () => {
		const order: string[] = [];
		let release: (() => void) | undefined;
		const client = {
			sendMessage: async (_account: unknown, args: { to: string; text: string }) => {
				if (args.to === "slow") await new Promise<void>((resolve) => (release = resolve));
				order.push(args.text);
				return { ret: 0 };
			},
		} as unknown as WechatClient;
		const deliverer = createDeliverer({
			client: () => client,
			account: () => ACCOUNT,
			maxReplyChars: () => 1000,
			cdnBaseUrl: "",
			maxMediaBytes: 1024,
			notify: () => {},
			onExpired: () => {},
			forgetToken: () => {},
		});
		const slow = deliverer.reply({ peer: "slow" }, "one");
		const fast = deliverer.reply({ peer: "fast" }, "two");
		await settle();
		expect(order).toEqual(["two"]);
		release?.();
		await Promise.all([slow, fast]);
		expect(order).toEqual(["two", "one"]);
	});
});
