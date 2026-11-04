/**
 * The owner-bound send behind `send_wechat`: the shape rule, and what each shape costs.
 *
 * The deliverer is a double, because the upload and the wire are `transport/`'s to prove
 * (`transport/client.test.ts`). What is settled here is the policy: which field reaches
 * which delivery method, when a text is refused, and what a failure says.
 */

import { describe, expect, test } from "bun:test";
import type { Deliverer } from "./transport/deliver.ts";
import { sendOwnerMessage, type OwnerSendDeps } from "./owner-send.ts";

const owner = "owner@im.wechat";
const signal = new AbortController().signal;

/** What one send asked the deliverer to do, in order. */
interface Recorded {
	kind: "reply" | "prompt" | "file" | "image" | "toOwner";
	args: unknown[];
}

function fakeDeliverer(options: { file?: () => Promise<boolean>; image?: () => Promise<boolean> } = {}): {
	deliverer: Deliverer;
	calls: Recorded[];
} {
	const calls: Recorded[] = [];
	const deliverer: Deliverer = {
		async reply(...args) {
			calls.push({ kind: "reply", args });
			return true;
		},
		async prompt(...args) {
			calls.push({ kind: "prompt", args });
			return true;
		},
		async file(...args) {
			calls.push({ kind: "file", args });
			return options.file === undefined ? true : await options.file();
		},
		async image(...args) {
			calls.push({ kind: "image", args });
			return options.image === undefined ? true : await options.image();
		},
		async toOwner(...args) {
			calls.push({ kind: "toOwner", args });
			return { ok: true };
		},
		reset() {},
	};
	return { deliverer, calls };
}

function ownerSend(deliverer: Deliverer, options: { running?: boolean } = {}): OwnerSendDeps {
	return {
		target: { peer: owner, contextToken: "ctx" },
		deliverer,
		signal: () => signal,
		ownerTurnRunning: () => options.running ?? false,
	};
}

describe("owner send", () => {
	test("sends the text through the owner path, sanitized", async () => {
		const { deliverer, calls } = fakeDeliverer();
		expect(await sendOwnerMessage(ownerSend(deliverer), { text: "  hello\u0001 " })).toEqual({ ok: true });
		expect(calls).toEqual([{ kind: "toOwner", args: [owner, "ctx", "hello", signal] }]);
	});

	test("refuses a text while the owner's own turn runs", async () => {
		const { deliverer, calls } = fakeDeliverer();
		expect(await sendOwnerMessage(ownerSend(deliverer, { running: true }), { text: "hi back" })).toEqual({
			ok: false,
			error: "The bridge replies to this turn automatically; do not repeat it.",
		});
		expect(calls).toEqual([]);
	});

	test("refuses a text that sanitizing leaves empty", async () => {
		const { deliverer, calls } = fakeDeliverer();
		expect(await sendOwnerMessage(ownerSend(deliverer), { text: "\u0001 \n" })).toEqual({
			ok: false,
			error: "Nothing to send.",
		});
		expect(calls).toEqual([]);
	});

	test("sends an image as a picture", async () => {
		const { deliverer, calls } = fakeDeliverer();
		expect(await sendOwnerMessage(ownerSend(deliverer), { image: "/tmp/plot.png" })).toEqual({ ok: true });
		expect(calls).toEqual([{ kind: "image", args: [{ peer: owner, contextToken: "ctx" }, "/tmp/plot.png", signal] }]);
	});

	test("sends a file as a document named by its base name", async () => {
		const { deliverer, calls } = fakeDeliverer();
		expect(await sendOwnerMessage(ownerSend(deliverer), { file: "/tmp/reports/weekly.pdf" })).toEqual({ ok: true });
		expect(calls).toEqual([
			{ kind: "file", args: [{ peer: owner, contextToken: "ctx" }, "/tmp/reports/weekly.pdf", "weekly.pdf", signal] },
		]);
	});

	test("sends a file whose bytes are an image as a document", async () => {
		const { deliverer, calls } = fakeDeliverer();
		expect(await sendOwnerMessage(ownerSend(deliverer), { file: "/tmp/plot.png" })).toEqual({ ok: true });
		// The field names the shape and not the bytes: the sniff is `image`'s own gate.
		expect(calls.map((call) => call.kind)).toEqual(["file"]);
	});

	test("allows media while the owner's turn runs, though text is refused there", async () => {
		const { deliverer, calls } = fakeDeliverer();
		const deps = ownerSend(deliverer, { running: true });
		expect(await sendOwnerMessage(deps, { image: "/tmp/plot.png" })).toEqual({ ok: true });
		expect(await sendOwnerMessage(deps, { file: "/tmp/report.pdf" })).toEqual({ ok: true });
		expect(calls.map((call) => call.kind)).toEqual(["image", "file"]);
	});

	test("names the shape that failed, so the model can report it", async () => {
		const failing = fakeDeliverer({ file: async () => false, image: async () => false });
		const deps = ownerSend(failing.deliverer);
		expect(await sendOwnerMessage(deps, { file: "/tmp/report.pdf" })).toEqual({
			ok: false,
			error: "The file could not be sent; see the terminal notice.",
		});
		expect(await sendOwnerMessage(deps, { image: "/tmp/plot.png" })).toEqual({
			ok: false,
			error: "The image could not be sent; see the terminal notice.",
		});
	});
});
