/**
 * The media an inbound message resolves: the file line a turn is handed, and the
 * image blocks it is attached to.
 *
 * `createInboundAdmission` is driven directly with the fixture's client, so the
 * result is asserted where it is built — a file's size and type come from the bytes
 * the bridge wrote, not from the name the peer sent, and an image is asserted as the
 * bytes the key it arrived with produced.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../../test/helpers/env.ts";
import { encrypt, key, makeClient } from "../../../test/helpers/fixtures/wechat-bridge.ts";
import type { ChatItem } from "../conversation/turn.ts";
import type { FileRef, InboundItem } from "../types.ts";
import { createInboundAdmission, type InboundDeps } from "./inbound.ts";

/** A key as a sender writes it into `media.aes_key`: base64 of the hex string. */
const wireKey = Buffer.from(key.toString("hex")).toString("base64");

/** A 16-byte key that never encrypted the fixture's bytes, as the wire writes it. */
const otherKey = Buffer.from("ff".repeat(16)).toString("base64");

/** One admission's outcome: what reached the turn queue, and what the terminal was told. */
interface Admitted {
	item: ChatItem | undefined;
	notices: string[];
	dir: string;
}

/** Admit one item against a fresh client, in `dir` when given, and report what it produced. */
async function admit(
	item: InboundItem,
	url: string,
	cipher: Buffer,
	dir = tempDir("wechat-inbound-"),
): Promise<Admitted> {
	const { client } = makeClient([], { media: { [url]: cipher } });
	const queued: ChatItem[] = [];
	const notices: string[] = [];
	const deps: InboundDeps = {
		client: () => client,
		signal: () => undefined,
		maxMediaBytes: () => 20 * 1024 * 1024,
		mediaDir: () => dir,
		now: () => 1000,
		notify: (message) => notices.push(message),
		reply: async () => true,
		enqueue: (queuedItem) => queued.push(queuedItem),
		pruneTyping: () => {},
		isRunning: () => true,
	};
	await createInboundAdmission(deps).admit(item, () => true);
	return { item: queued[0], notices, dir };
}

/** One inbound file's reference, with the hash of its plaintext when the wire gave one. */
function fileRef(plain: Uint8Array, fileName: string, aesKey = wireKey): FileRef {
	return {
		kind: "file",
		media: { full_url: "https://cdn/f", aes_key: aesKey },
		fileName,
		md5: createHash("md5").update(plain).digest("hex"),
	};
}

/** Admit one file's bytes under `fileName`, and report the text and path it produced. */
async function admitFile(plain: Uint8Array, fileName: string): Promise<{ text: string; path: string }> {
	const item: InboundItem = { peer: "owner", text: "", media: [fileRef(plain, fileName)], language: "en" };
	const text = (await admit(item, "https://cdn/f", encrypt(plain))).item?.text ?? "";
	return { text, path: /saved to (.*)\]$/.exec(text)?.[1] ?? "" };
}

describe("the inbound file line", () => {
	test("carries the saved size and the type the bytes name", async () => {
		const plain = Buffer.from("a,b\nc,d\n");
		const { text, path } = await admitFile(plain, "rows.csv");
		expect(text).toBe(`[WeChat file: rows.csv, 8 B, text/plain, saved to ${path}]`);
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path)).toEqual(plain);
	});

	test("names the bytes, not the extension the peer gave them", async () => {
		const { text } = await admitFile(Buffer.from("%PDF-1.7\nbody"), "report.docx");
		expect(text.startsWith("[WeChat file: report.docx, 13 B, application/pdf, saved to ")).toBe(true);
	});

	test("leaves the type out when the bytes name nothing", async () => {
		const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
		const { text } = await admitFile(ole2, "legacy.doc");
		expect(text.startsWith("[WeChat file: legacy.doc, 8 B, saved to ")).toBe(true);
	});
});

describe("a file the CDN deduplicated", () => {
	const plain = Buffer.from("a,b\nc,d\n");

	test("resolves a repeat to the copy saved the first time", async () => {
		const first = await admit(
			{ peer: "owner", text: "", media: [fileRef(plain, "rows.csv")], language: "en" },
			"https://cdn/f",
			encrypt(plain),
		);
		const saved = /saved to (.*)\]$/.exec(first.item?.text ?? "")?.[1] ?? "";
		// The same blob comes back with a key that never encrypted it: PKCS#7 refuses it.
		const second = await admit(
			{ peer: "owner", text: "", media: [fileRef(plain, "rows.csv", otherKey)], language: "en" },
			"https://cdn/f",
			encrypt(plain),
			first.dir,
		);

		expect(second.item?.text).toBe(`[WeChat file: rows.csv, 8 B, text/plain, saved to ${saved}]`);
		expect(second.notices).toEqual([
			"WeChat stored this repeat of rows.csv under a different key; used the copy saved earlier.",
		]);
	});

	test("says why it cannot be read when no copy was kept", async () => {
		const { item, notices } = await admit(
			{ peer: "owner", text: "look", media: [fileRef(plain, "rows.csv", otherKey)], language: "en" },
			"https://cdn/f",
			encrypt(plain),
		);

		expect(item?.text).toBe("look\n[WeChat media skipped: 1]");
		expect(notices).toEqual([
			"WeChat media dropped: rows.csv — the server kept an earlier copy under another key, so this repeat cannot be read.",
		]);
	});
});

describe("the inbound image", () => {
	test("decrypts with the key in media.aes_key, which arrives as base64 of the hex string", async () => {
		const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
		const item: InboundItem = {
			peer: "owner",
			text: "",
			media: [{ kind: "image", media: { full_url: "https://cdn/i", aes_key: wireKey } }],
			language: "en",
		};
		const queued = (await admit(item, "https://cdn/i", encrypt(plain))).item;
		expect(queued?.images).toEqual([{ type: "image", data: plain.toString("base64"), mimeType: "image/png" }]);
	});
});
