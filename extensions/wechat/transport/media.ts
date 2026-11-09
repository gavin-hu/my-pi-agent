/**
 * Media shared by both directions: the AES key and block codec, the CDN URLs, the
 * image and file sniff, the filename sanitize, the one disk write an attachment
 * needs, the sweep that takes an old one away, and the name an inbound file is
 * saved under, which is also how a repeat of it is found again.
 *
 * Weixin media are AES-128-ECB with PKCS#7 padding (Node's `node:crypto`), so
 * there is no extra dependency. Everything here is pure or filesystem-only; the
 * HTTP transfer is injected through the client, and tests never touch the network.
 *
 * It also owns the one rule that turns a value from the wire into a filesystem
 * name (`sanitizePathSegment`), which a media filename and an inbound path
 * directory both use.
 */

import { createCipheriv, createDecipheriv } from "node:crypto";
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripControlChars } from "../../../lib/format.ts";
import type { CDNMedia } from "../types.ts";

/**
 * Decode a Weixin media AES key to 16 bytes: 32 hex characters, base64 of those
 * characters, or base64 of the raw bytes, which are the three forms the wire and a
 * peer send.
 */
export function decodeMediaKey(value: string): Buffer {
	const trimmed = value.trim();
	if (/^[0-9a-fA-F]{32}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
	const decoded = Buffer.from(trimmed, "base64");
	// Senders encode the hex *string* as base64, so a 32-byte decode spells the key.
	const hex = decoded.toString("latin1");
	if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(hex)) return Buffer.from(hex, "hex");
	if (decoded.length !== 16) throw new Error("WeChat media key is not 16 bytes.");
	return decoded;
}

/** Decrypt AES-128-ECB with PKCS#7 padding. */
export function decryptEcb(cipher: Uint8Array, key: Buffer): Buffer {
	const decipher = createDecipheriv("aes-128-ecb", key, null);
	return Buffer.concat([decipher.update(cipher), decipher.final()]);
}

/**
 * Whether `error` is OpenSSL refusing the last block, which is what a key that never
 * encrypted these bytes produces. The cast is read only for the `code` property, and
 * a value without one is not this failure.
 */
export function isPaddingFailure(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ERR_OSSL_BAD_DECRYPT";
}

/** Encrypt AES-128-ECB with PKCS#7 padding (the mirror of {@link decryptEcb}). */
export function encryptEcb(plain: Uint8Array, key: Buffer): Buffer {
	const cipher = createCipheriv("aes-128-ecb", key, null);
	return Buffer.concat([cipher.update(plain), cipher.final()]);
}

/** Ciphertext size for AES-128-ECB with PKCS#7 padding. */
export function aesEcbPaddedSize(plaintextSize: number): number {
	return Math.ceil((plaintextSize + 1) / 16) * 16;
}

/**
 * The MIME a common image's magic bytes name, or `undefined` when they name none.
 *
 * `undefined` is what an outbound image send refuses on; the inbound attach path
 * decides its own fallback, because a peer's photo is worth passing on even when
 * the header is unfamiliar.
 */
export function sniffImageMime(bytes: Uint8Array): string | undefined {
	if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return "image/png";
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
		return "image/gif";
	}
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "image/webp";
	}
	return undefined;
}

/** Whether `bytes` begin with `prefix`. */
function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
	if (bytes.length < prefix.length) return false;
	return prefix.every((byte, index) => bytes[index] === byte);
}

/** How much of a file is probed for printable bytes before the whole of it is decoded. */
const TEXT_PROBE_BYTES = 8192;

/** True when the first bytes hold no NUL and nothing a text editor would call a control character. */
function looksPrintable(bytes: Uint8Array): boolean {
	for (let index = 0; index < Math.min(bytes.length, TEXT_PROBE_BYTES); index++) {
		const byte = bytes[index] ?? 0;
		if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
	}
	return true;
}

/** True when the whole of `bytes` decodes as UTF-8. */
function isUtf8(bytes: Uint8Array): boolean {
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

/**
 * The MIME an inbound file's bytes name, for the line a turn is handed: an image
 * by {@link sniffImageMime}, then a document container, then text.
 *
 * The answer is the bytes', never the sender's: a `report.docx` that holds a PDF is
 * named a PDF. `undefined` is a file nothing here recognizes, and the caller leaves
 * the type out rather than repeating an extension it did not check. A legacy OLE2
 * document (`D0 CF 11 E0`) is deliberately not named — `.doc`, `.xls`, and `.ppt`
 * share that header, so one MIME would be wrong for two of them.
 */
export function sniffFileMime(bytes: Uint8Array): string | undefined {
	const image = sniffImageMime(bytes);
	if (image) return image;
	if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
	// OOXML (.docx, .xlsx, .pptx), ODF, and a plain archive are all ZIP containers.
	if (hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
	if (hasPrefix(bytes, [0x1f, 0x8b])) return "application/gzip";
	if (looksPrintable(bytes) && isUtf8(bytes)) return "text/plain";
	return undefined;
}

/**
 * One filesystem name from a value that came off the wire: control characters and
 * path separators stripped, no leading dot, capped length, and never empty — the
 * caller names the fallback it wants for an emptied value.
 */
export function sanitizePathSegment(value: string, fallback: string): string {
	const cleaned = stripControlChars(value).replace(/[\\/]/g, "_").replace(/^\.+/, "").trim();
	const safe = cleaned || fallback;
	return safe.length > 120 ? safe.slice(0, 120) : safe;
}

/** An inbound file's name, as one path segment. */
export function sanitizeFileName(name: string): string {
	return sanitizePathSegment(name, "file");
}

/** The CDN URL for a media reference, preferring a server-provided full URL. */
export function mediaDownloadUrl(ref: CDNMedia, cdnBaseUrl: string): string {
	if (ref.full_url) return ref.full_url;
	const param = ref.encrypt_query_param ?? "";
	return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(param)}`;
}

/** The CDN upload URL from an `upload_param` and the `filekey`. */
function buildUploadUrl(cdnBaseUrl: string, uploadParam: string, filekey: string): string {
	return `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
}

/** The upload target from a `getUploadUrl` result, preferring a full URL. */
export function uploadUrlOf(
	response: { uploadFullUrl?: string; uploadParam?: string },
	cdnBaseUrl: string,
	filekey: string,
): string {
	const full = response.uploadFullUrl?.trim();
	if (full) return full;
	if (response.uploadParam) return buildUploadUrl(cdnBaseUrl, response.uploadParam, filekey);
	throw new Error("WeChat upload URL missing (need upload_full_url or upload_param).");
}

/**
 * The name an inbound file is saved under: the moment it arrived, a counter, the md5
 * its own bytes hash to when the wire gives one, then the peer's name.
 *
 * The md5 is in the name because it is the same for a file sent twice, while the key
 * is not: it is the only handle on the copy a deduplicated repeat should resolve to.
 * `<now>-<counter>-<md5>-<fileName>` — `now` and `counter` are the leading segments
 * {@link findSavedFile} checks before it trusts the third.
 */
export function savedFileName(now: number, counter: number, md5: string | undefined, fileName: string): string {
	return [now, counter, ...(md5 ? [md5] : []), fileName].join("-");
}

/** The file saved earlier under this content hash, or `undefined` when the directory holds none. */
export function findSavedFile(dir: string, md5: string | undefined): string | undefined {
	if (!md5) return undefined;
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return undefined;
	}
	for (const name of names) {
		const [stamp, counter, hash] = name.split("-");
		// The first two segments are this module's own, so a peer's name cannot spell them.
		if (hash !== md5 || !/^\d+$/.test(stamp ?? "") || !/^\d+$/.test(counter ?? "")) continue;
		return join(dir, name);
	}
	return undefined;
}

/** Write `bytes` to `dir/name`, owner-only, creating `dir`, and return the full path. */
export function saveMedia(dir: string, name: string, bytes: Uint8Array): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	// An inbound attachment is the account's: it lands `0600` like the state and the
	// credentials beside it, and a turn reads it back as the same user whatever the mode.
	writeFileSync(path, bytes, { mode: 0o600 });
	return path;
}

/**
 * Delete the files under `dir` whose mtime is older than `maxAgeMs`, and return how
 * many went.
 *
 * Age is the rule rather than a count, because a turn may still hold the path of the
 * message it is answering: the file it was handed was written seconds ago. A window of
 * `0` or less keeps everything. What cannot be read is not this sweep's business — a
 * directory that does not exist yet, a subdirectory, a file that vanished between the
 * listing and the unlink — so the caller gets a count instead of an error.
 */
export function pruneMedia(dir: string, maxAgeMs: number, now: number): number {
	if (maxAgeMs <= 0) return 0;
	let names: string[];
	try {
		names = readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name);
	} catch {
		return 0;
	}
	let pruned = 0;
	for (const name of names) {
		const path = join(dir, name);
		try {
			if (now - statSync(path).mtimeMs < maxAgeMs) continue;
			unlinkSync(path);
			pruned += 1;
		} catch {
			// A file that vanished, a name that is not a file, a directory read that is
			// not ours: one entry the sweep cannot take is not a failed sweep.
		}
	}
	return pruned;
}
