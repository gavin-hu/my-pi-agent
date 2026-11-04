/**
 * Outbound media: encrypt one local file and deliver it as a Weixin attachment.
 *
 * The flow mirrors the reference client: read the plaintext, compute its size and
 * MD5, generate a 16-byte AES key and a file key, request the CDN upload target,
 * upload the AES-128-ECB ciphertext, then send the item whose media reference
 * carries the returned download parameter. The upload is one body; the item is a
 * `type: 4` file or a `type: 2` image, and an image must sniff as one.
 *
 * Everything is injected, so it is tested with a fake client and a temp file.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { rejectionOf, type WechatClient } from "./client.ts";
import { aesEcbPaddedSize, encryptEcb, sanitizeFileName, sniffImageMime, uploadUrlOf } from "./media.ts";
import type { BotCredentials, CDNMedia, SendResponse } from "../types.ts";

/** `UploadMediaType.FILE` from the protocol. */
export const UPLOAD_MEDIA_TYPE_FILE = 3;

/** `UploadMediaType.IMAGE` from the protocol. */
export const UPLOAD_MEDIA_TYPE_IMAGE = 1;

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
	/** The file read; defaults to `readFileSync`, injected to prove a refused size is never read. */
	readFile?: (path: string) => Buffer;
}

/** One encrypted upload, with what both item shapes need to describe it. */
interface Uploaded {
	/** Plaintext size in bytes, the `len` of a file item. */
	rawsize: number;
	/** Padded ciphertext size, the `mid_size` of an image item. */
	filesize: number;
	media: CDNMedia;
	/** The AES key as 32 hex characters, which an image item names itself. */
	aeskey: string;
}

/**
 * Encrypt and upload one local file's bytes; `undefined` when the buffer in hand is
 * empty or past the cap, which is a file that changed between the stat and the read.
 */
async function uploadLocal(args: SendLocalFileArgs, mediaType: number, plain: Buffer): Promise<Uploaded | undefined> {
	if (plain.length === 0 || plain.length > args.maxBytes) return undefined;

	const random = args.random ?? randomBytes;
	const aesKey = random(16);
	const filekey = random(16).toString("hex");
	const rawsize = plain.length;
	const rawfilemd5 = createHash("md5").update(plain).digest("hex");
	const filesize = aesEcbPaddedSize(rawsize);
	const aeskey = aesKey.toString("hex");

	const upload = await args.client.getUploadUrl(
		args.account,
		{ filekey, mediaType, toUserId: args.to, rawsize, rawfilemd5, filesize, aeskey },
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
		aes_key: Buffer.from(aeskey).toString("base64"),
		encrypt_type: 1,
	};
	return { rawsize, filesize, media, aeskey };
}

/**
 * Read, screen, and upload one local file; `undefined` when it is unreadable or
 * refused, including by the caller's own `accept`.
 *
 * The cap is decided from `stat` before the read: a multi-gigabyte file must be
 * refused without ever being buffered, or the refusal is what runs out of memory.
 */
async function readAndUpload(
	args: SendLocalFileArgs,
	mediaType: number,
	accept?: (plain: Buffer) => boolean,
): Promise<Uploaded | undefined> {
	try {
		const size = statSync(args.filePath).size;
		if (size === 0 || size > args.maxBytes) return undefined;
		const plain = (args.readFile ?? readFileSync)(args.filePath);
		if (accept !== undefined && !accept(plain)) return undefined;
		return await uploadLocal(args, mediaType, plain);
	} catch {
		return undefined;
	}
}

/** True when the server accepted the item; any failure is the caller's fallback. */
async function accepted(send: () => Promise<SendResponse>): Promise<boolean> {
	try {
		return rejectionOf(await send()) === undefined;
	} catch {
		return false;
	}
}

/**
 * Upload and send a local file. Returns true when the message was accepted.
 * Any failure (unreadable file, size cap, upload rejection) returns false rather
 * than throwing, so the caller can fall back.
 */
export async function sendLocalFile(args: SendLocalFileArgs): Promise<boolean> {
	const uploaded = await readAndUpload(args, UPLOAD_MEDIA_TYPE_FILE);
	if (!uploaded) return false;
	return accepted(() =>
		args.client.sendFileMessage(
			args.account,
			{
				to: args.to,
				fileName: sanitizeFileName(args.fileName ?? basename(args.filePath)),
				len: String(uploaded.rawsize),
				media: uploaded.media,
				contextToken: args.contextToken,
			},
			args.signal,
		),
	);
}

/**
 * Upload and send a local image as a picture, not a document.
 *
 * A file whose bytes sniff as no image is refused before the upload, so this path
 * cannot become a general file sender. Everything else matches
 * {@link sendLocalFile}: false on any failure, for the caller to fall back on.
 */
export async function sendLocalImage(args: SendLocalFileArgs): Promise<boolean> {
	const uploaded = await readAndUpload(args, UPLOAD_MEDIA_TYPE_IMAGE, (plain) => sniffImageMime(plain) !== undefined);
	if (!uploaded) return false;
	return accepted(() =>
		args.client.sendImageMessage(
			args.account,
			{
				to: args.to,
				media: uploaded.media,
				midSize: uploaded.filesize,
				aeskey: uploaded.aeskey,
				contextToken: args.contextToken,
			},
			args.signal,
		),
	);
}
