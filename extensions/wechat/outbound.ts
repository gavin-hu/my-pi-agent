/**
 * Outbound file sending: encrypt a local file and deliver it as one Weixin file
 * message.
 *
 * The flow mirrors the reference client: read the plaintext, compute its size and
 * MD5, generate a 16-byte AES key and a file key, request the CDN upload target,
 * upload the AES-128-ECB ciphertext, then send a `type: 4` file item whose media
 * reference carries the returned download parameter.
 *
 * Everything is injected, so it is tested with a fake client and a temp file.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { WechatClient } from "./client.ts";
import { aesEcbPaddedSize, encryptEcb, sanitizeFileName, uploadUrlOf } from "./media.ts";
import type { BotCredentials, CDNMedia } from "./types.ts";

/** `UploadMediaType.FILE` from the protocol. */
export const UPLOAD_MEDIA_TYPE_FILE = 3;

export interface SendLocalFileArgs {
	client: WechatClient;
	account: BotCredentials;
	cdnBaseUrl: string;
	/** Files larger than this are refused. */
	maxBytes: number;
	to: string;
	contextToken?: string;
	filePath: string;
	/** Display name; defaults to the file's base name, sanitized. */
	fileName?: string;
	signal?: AbortSignal;
	/** Random bytes for the AES key and file key; defaults to `crypto.randomBytes`. */
	random?: (size: number) => Buffer;
}

/**
 * Upload and send a local file. Returns true when the message was accepted.
 * Any failure (unreadable file, size cap, upload rejection) returns false rather
 * than throwing, so the caller can fall back.
 */
export async function sendLocalFile(args: SendLocalFileArgs): Promise<boolean> {
	try {
		const plain = readFileSync(args.filePath);
		if (plain.length === 0 || plain.length > args.maxBytes) return false;

		const random = args.random ?? randomBytes;
		const aesKey = random(16);
		const filekey = random(16).toString("hex");
		const rawsize = plain.length;
		const rawfilemd5 = createHash("md5").update(plain).digest("hex");
		const filesize = aesEcbPaddedSize(rawsize);

		const upload = await args.client.getUploadUrl(
			args.account,
			{
				filekey,
				mediaType: UPLOAD_MEDIA_TYPE_FILE,
				toUserId: args.to,
				rawsize,
				rawfilemd5,
				filesize,
				aeskey: aesKey.toString("hex"),
			},
			args.signal,
		);

		const downloadParam = await args.client.uploadCdn(
			uploadUrlOf(upload, args.cdnBaseUrl, filekey),
			encryptEcb(plain, aesKey),
			args.signal,
		);

		// The reference encodes the hex key string as base64 (not the raw 16 bytes);
		// the download decoder accepts either.
		const media: CDNMedia = {
			encrypt_query_param: downloadParam,
			aes_key: Buffer.from(aesKey.toString("hex")).toString("base64"),
			encrypt_type: 1,
		};

		const response = await args.client.sendFileMessage(
			args.account,
			{
				to: args.to,
				fileName: sanitizeFileName(args.fileName ?? basename(args.filePath)),
				len: String(rawsize),
				media,
				contextToken: args.contextToken,
			},
			args.signal,
		);

		const retBad = response.ret !== undefined && response.ret !== 0;
		const codeBad = response.errcode !== undefined && response.errcode !== 0;
		return !retBad && !codeBad;
	} catch {
		return false;
	}
}
