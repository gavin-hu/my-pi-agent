/**
 * The inbound file line: what a turn is handed for an attachment the bridge saved.
 *
 * `createInboundAdmission` is driven directly with the fixture's client, so the line
 * is asserted where it is built — its size and type come from the bytes the bridge
 * wrote, not from the name the peer sent.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../../test/helpers/env.ts";
import { encrypt, key, makeClient } from "../../../test/helpers/fixtures/wechat-bridge.ts";
import type { ChatItem } from "../conversation/turn.ts";
import type { InboundItem } from "../types.ts";
import { createInboundAdmission, type InboundDeps } from "./inbound.ts";

/** Admit one file's bytes under `fileName`, and report the text and path it produced. */
async function admitFile(plain: Uint8Array, fileName: string): Promise<{ text: string; path: string }> {
	const { client } = makeClient([], { media: { "https://cdn/f": encrypt(plain) } });
	const mediaDir = tempDir("wechat-inbound-");
	const queued: ChatItem[] = [];
	const deps: InboundDeps = {
		client: () => client,
		signal: () => undefined,
		maxMediaBytes: () => 20 * 1024 * 1024,
		mediaDir: () => mediaDir,
		now: () => 1000,
		notify: () => {},
		reply: async () => true,
		enqueue: (item) => queued.push(item),
		pruneTyping: () => {},
		isRunning: () => true,
	};
	const item: InboundItem = {
		peer: "owner",
		text: "",
		media: [{ kind: "file", media: { full_url: "https://cdn/f", aes_key: key.toString("base64") }, fileName }],
		language: "en",
	};
	await createInboundAdmission(deps).admit(item, () => true);
	const text = queued[0]?.text ?? "";
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
