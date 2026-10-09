/**
 * Inbound media helpers: decode the AES key, download from the CDN, decrypt,
 * sniff the image type, and save to disk.
 *
 * Weixin media are AES-128-ECB with PKCS#7 padding (Node's `node:crypto`), so
 * there is no extra dependency. Everything here is pure or filesystem-only; the
 * HTTP fetch is injected through the client, and tests never touch the network.
 */

import { createDecipheriv } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripControlChars } from "../../lib/format.ts";
import type { CDNMedia } from "./types.ts";

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

/** Sniff a common image MIME from magic bytes; defaults to `image/jpeg`. */
export function sniffImageMime(bytes: Uint8Array): string {
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
	return "image/jpeg";
}

/** A filesystem extension for a sniffed image MIME. */
export function imageExtension(mime: string): string {
	switch (mime) {
		case "image/png":
			return "png";
		case "image/gif":
			return "gif";
		case "image/webp":
			return "webp";
		default:
			return "jpg";
	}
}

/** Strip control characters and path separators, cap length, and never empty. */
export function sanitizeFileName(name: string): string {
	const cleaned = stripControlChars(name).replace(/[\\/]/g, "_").replace(/^\.+/, "").trim();
	const safe = cleaned || "file";
	return safe.length > 120 ? safe.slice(0, 120) : safe;
}

/** The CDN URL for a media reference, preferring a server-provided full URL. */
export function mediaDownloadUrl(ref: CDNMedia, cdnBaseUrl: string): string {
	if (ref.full_url) return ref.full_url;
	const param = ref.encrypt_query_param ?? "";
	return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(param)}`;
}

/** Write `bytes` to `dir/name`, creating `dir`, and return the full path. */
export function saveMedia(dir: string, name: string, bytes: Uint8Array): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, bytes);
	return path;
}
