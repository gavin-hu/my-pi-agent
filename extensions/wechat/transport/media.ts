/**
 * Media shared by both directions: the AES key and block codec, the CDN URLs, the
 * image sniff, the filename sanitize, and the one disk write an attachment needs
 * beside the sweep that takes an old one away.
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

/** Decode a Weixin media AES key from 32 hex chars or base64 to 16 bytes. */
export function decodeMediaKey(value: string): Buffer {
	const trimmed = value.trim();
	const key = /^[0-9a-fA-F]{32}$/.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
	if (key.length !== 16) throw new Error("WeChat media key is not 16 bytes.");
	return key;
}

/** Decrypt AES-128-ECB with PKCS#7 padding. */
export function decryptEcb(cipher: Uint8Array, key: Buffer): Buffer {
	const decipher = createDecipheriv("aes-128-ecb", key, null);
	return Buffer.concat([decipher.update(cipher), decipher.final()]);
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

/** Write `bytes` to `dir/name`, creating `dir`, and return the full path. */
export function saveMedia(dir: string, name: string, bytes: Uint8Array): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, bytes);
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
