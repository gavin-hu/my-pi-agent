/**
 * Outbound media: one local file or image encrypted, uploaded, and sent as an
 * attachment.
 *
 * Every seam is injected — the client, the random source, the file read — and the
 * files live in a temp directory, so nothing here touches the network or a real
 * session.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../../test/helpers/env.ts";
import type { WechatClient } from "./client.ts";
import { aesEcbPaddedSize, encryptEcb } from "./media.ts";
import { sendLocalFile, sendLocalImage, UPLOAD_MEDIA_TYPE_FILE, UPLOAD_MEDIA_TYPE_IMAGE } from "./outbound.ts";
import type { BotCredentials } from "../types.ts";

const ACCOUNT: BotCredentials = {
	botToken: "tok",
	ilinkUserId: "u",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: 0,
};

describe("outbound files", () => {
	function fakeClient() {
		const uploadRequests: Array<Record<string, unknown>> = [];
		const uploads: Array<{ url: string; body: Uint8Array }> = [];
		const sent: Array<Record<string, unknown>> = [];
		const images: Array<Record<string, unknown>> = [];
		let uploadParam: string | undefined = "up";
		let fullUrl: string | undefined;
		let uploadResult = "dl";
		let uploadError: Error | undefined;
		let sendRet: number | undefined = 0;

		const fake = {
			getUploadUrl: async (_account: BotCredentials, req: Record<string, unknown>) => {
				uploadRequests.push(req);
				return { uploadParam, uploadFullUrl: fullUrl };
			},
			uploadCdn: async (url: string, body: Uint8Array) => {
				uploads.push({ url, body });
				if (uploadError) throw uploadError;
				return uploadResult;
			},
			sendFileMessage: async (_account: BotCredentials, args: Record<string, unknown>) => {
				sent.push(args);
				return { ret: sendRet };
			},
			sendImageMessage: async (_account: BotCredentials, args: Record<string, unknown>) => {
				images.push(args);
				return { ret: sendRet };
			},
		} as unknown as WechatClient;

		return {
			client: fake,
			uploadRequests,
			uploads,
			sent,
			images,
			setFullUrl: (value: string | undefined) => {
				fullUrl = value;
			},
			setUploadError: (value: Error) => {
				uploadError = value;
			},
			setSendRet: (value: number | undefined) => {
				sendRet = value;
			},
		};
	}

	function tempFile(content: string): string {
		const path = join(tempDir("wechat-outbound-"), "plan.md");
		writeFileSync(path, content);
		return path;
	}

	const fixedRandom = (size: number): Buffer => Buffer.alloc(size, 0xab);

	function baseArgs(path: string, fake: WechatClient) {
		return {
			client: fake,
			account: ACCOUNT,
			cdnBaseUrl: "https://cdn/c2c",
			maxBytes: 1024,
			to: "peer",
			contextToken: "ctx",
			filePath: path,
			random: fixedRandom,
		};
	}

	test("uploads an image with the image media type and sends an image item", async () => {
		const path = join(tempDir("wechat-outbound-"), "plot.png");
		const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), Buffer.from("body")]);
		writeFileSync(path, png);
		const h = fakeClient();

		expect(await sendLocalImage(baseArgs(path, h.client))).toBe(true);
		const key = fixedRandom(16).toString("hex");
		expect(h.uploadRequests[0]).toMatchObject({ mediaType: UPLOAD_MEDIA_TYPE_IMAGE, aeskey: key });
		// An image item carries no file name: the phone draws a picture, not a document.
		expect(h.images[0]).toEqual({
			to: "peer",
			midSize: aesEcbPaddedSize(png.length),
			aeskey: key,
			contextToken: "ctx",
			media: {
				encrypt_query_param: "dl",
				aes_key: Buffer.from(key).toString("base64"),
				encrypt_type: 1,
			},
		});
		expect(h.sent).toEqual([]);
	});

	test("refuses a file that is not an image, before uploading anything", async () => {
		const h = fakeClient();
		expect(await sendLocalImage(baseArgs(tempFile("plain text"), h.client))).toBe(false);
		expect(h.uploadRequests).toEqual([]);
		expect(h.images).toEqual([]);
	});

	test("refuses an empty or oversized image, and one the server rejects", async () => {
		const path = join(tempDir("wechat-outbound-"), "tiny.png");
		writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
		const h = fakeClient();
		expect(await sendLocalImage({ ...baseArgs(path, h.client), maxBytes: 2 })).toBe(false);

		h.setSendRet(1);
		expect(await sendLocalImage(baseArgs(path, h.client))).toBe(false);
	});

	test("uploads the ciphertext and sends a file item", async () => {
		const content = "plan body";
		const path = tempFile(content);
		const h = fakeClient();
		const ok = await sendLocalFile(baseArgs(path, h.client));

		expect(ok).toBe(true);
		const key = fixedRandom(16).toString("hex");
		expect(h.uploadRequests[0]).toMatchObject({
			filekey: key,
			mediaType: UPLOAD_MEDIA_TYPE_FILE,
			toUserId: "peer",
			rawsize: Buffer.byteLength(content),
			rawfilemd5: createHash("md5").update(content).digest("hex"),
			filesize: aesEcbPaddedSize(Buffer.byteLength(content)),
			aeskey: key,
		});

		expect(h.uploads[0]?.url).toBe(
			"https://cdn/c2c/upload?encrypted_query_param=up&filekey=abababababababababababababababab",
		);
		expect(h.uploads[0]?.body).toEqual(encryptEcb(Buffer.from(content), fixedRandom(16)));

		expect(h.sent[0]).toMatchObject({
			to: "peer",
			fileName: "plan.md",
			len: String(Buffer.byteLength(content)),
			contextToken: "ctx",
			media: {
				encrypt_query_param: "dl",
				aes_key: Buffer.from(key).toString("base64"),
				encrypt_type: 1,
			},
		});
	});

	test("prefers a server-provided full upload URL", async () => {
		const path = tempFile("x");
		const h = fakeClient();
		h.setFullUrl("https://up/full");
		await sendLocalFile(baseArgs(path, h.client));
		expect(h.uploads[0]?.url).toBe("https://up/full");
	});

	test("refuses an oversize or empty file without uploading", async () => {
		const h = fakeClient();
		expect(await sendLocalFile({ ...baseArgs(tempFile("too big"), h.client), maxBytes: 2 })).toBe(false);
		expect(await sendLocalFile(baseArgs(tempFile(""), h.client))).toBe(false);
		expect(h.uploadRequests).toHaveLength(0);
	});

	test("refuses an oversize file before reading it", async () => {
		const h = fakeClient();
		let reads = 0;
		const ok = await sendLocalFile({
			...baseArgs(tempFile("too big"), h.client),
			maxBytes: 2,
			readFile: () => {
				reads += 1;
				return Buffer.from("too big");
			},
		});
		// The size came from the stat: a multi-gigabyte file is never buffered to be refused.
		expect(ok).toBe(false);
		expect(reads).toBe(0);
	});

	test("returns false for a missing file, a failed upload, or a rejected send", async () => {
		const h = fakeClient();
		expect(await sendLocalFile(baseArgs(join(tempDir("wechat-outbound-"), "nope.md"), h.client))).toBe(false);

		const failUpload = fakeClient();
		failUpload.setUploadError(new Error("cdn down"));
		expect(await sendLocalFile(baseArgs(tempFile("x"), failUpload.client))).toBe(false);

		const badSend = fakeClient();
		badSend.setSendRet(-1);
		expect(await sendLocalFile(baseArgs(tempFile("x"), badSend.client))).toBe(false);
	});

	test("sanitizes the file name", async () => {
		const h = fakeClient();
		await sendLocalFile({ ...baseArgs(tempFile("x"), h.client), fileName: "a/b.md" });
		expect(h.sent[0]?.fileName).toBe("a_b.md");
	});
});
