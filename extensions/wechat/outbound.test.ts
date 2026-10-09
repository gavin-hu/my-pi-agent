import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import type { WechatClient } from "./client.ts";
import { aesEcbPaddedSize, encryptEcb } from "./media.ts";
import { sendLocalFile, UPLOAD_MEDIA_TYPE_FILE } from "./outbound.ts";
import type { BotCredentials } from "./types.ts";

const account: BotCredentials = {
	botToken: "t",
	ilinkUserId: "u",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: 0,
};

function fakeClient() {
	const uploadRequests: Array<Record<string, unknown>> = [];
	const uploads: Array<{ url: string; body: Uint8Array }> = [];
	const sent: Array<Record<string, unknown>> = [];
	let uploadParam: string | undefined = "up";
	let fullUrl: string | undefined;
	let uploadResult = "dl";
	let uploadError: Error | undefined;
	let sendRet: number | undefined = 0;

	const client = {
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
	} as unknown as WechatClient;

	return {
		client,
		uploadRequests,
		uploads,
		sent,
		setFullUrl: (value: string | undefined) => {
			fullUrl = value;
		},
		setUploadParam: (value: string | undefined) => {
			uploadParam = value;
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

function baseArgs(path: string, client: WechatClient) {
	return {
		client,
		account,
		cdnBaseUrl: "https://cdn/c2c",
		maxBytes: 1024,
		to: "peer",
		contextToken: "ctx",
		filePath: path,
		random: fixedRandom,
	};
}

describe("sendLocalFile", () => {
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
