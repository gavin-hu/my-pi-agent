import { createCipheriv } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import {
	decodeMediaKey,
	decryptEcb,
	imageExtension,
	mediaDownloadUrl,
	sanitizeFileName,
	saveMedia,
	sniffImageMime,
} from "./media.ts";

describe("decodeMediaKey", () => {
	test("decodes a 32-character hex key", () => {
		expect(decodeMediaKey("00112233445566778899aabbccddeeff")).toEqual(
			Buffer.from("00112233445566778899aabbccddeeff", "hex"),
		);
	});

	test("decodes a base64 key", () => {
		const raw = Buffer.from("0123456789abcdef");
		expect(decodeMediaKey(raw.toString("base64"))).toEqual(raw);
	});

	test("rejects a key that is not 16 bytes", () => {
		expect(() => decodeMediaKey("abcd")).toThrow();
	});
});

describe("decryptEcb", () => {
	test("round-trips AES-128-ECB with PKCS#7 padding", () => {
		const key = Buffer.from("0123456789abcdef");
		const plaintext = Buffer.from("wechat media payload");
		const cipher = createCipheriv("aes-128-ecb", key, null);
		const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
		expect(decryptEcb(encrypted, key)).toEqual(plaintext);
	});
});

describe("sniffImageMime", () => {
	test("recognizes png, jpeg, gif, and webp", () => {
		expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))).toBe("image/png");
		expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 1]))).toBe("image/jpeg");
		expect(sniffImageMime(Buffer.from("GIF89a"))).toBe("image/gif");
		const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
		expect(sniffImageMime(webp)).toBe("image/webp");
	});

	test("defaults to jpeg for unknown bytes", () => {
		expect(sniffImageMime(Buffer.from([1, 2, 3]))).toBe("image/jpeg");
	});
});

describe("imageExtension", () => {
	test("maps the known image MIME types", () => {
		expect(imageExtension("image/png")).toBe("png");
		expect(imageExtension("image/gif")).toBe("gif");
		expect(imageExtension("image/webp")).toBe("webp");
		expect(imageExtension("image/jpeg")).toBe("jpg");
	});
});

describe("sanitizeFileName", () => {
	test("strips separators, control chars, and leading dots", () => {
		expect(sanitizeFileName("../a/b\u0000c.txt")).toBe("_a_b c.txt");
		expect(sanitizeFileName("   ")).toBe("file");
	});

	test("caps overly long names", () => {
		expect(sanitizeFileName("a".repeat(200)).length).toBe(120);
	});
});

describe("mediaDownloadUrl", () => {
	test("prefers a full URL", () => {
		expect(mediaDownloadUrl({ full_url: "https://cdn/x?y=1", encrypt_query_param: "p" }, "https://base")).toBe(
			"https://cdn/x?y=1",
		);
	});

	test("builds and encodes the fallback URL", () => {
		expect(mediaDownloadUrl({ encrypt_query_param: "a b&c" }, "https://base/c2c")).toBe(
			"https://base/c2c/download?encrypted_query_param=a%20b%26c",
		);
	});
});

describe("saveMedia", () => {
	test("creates the directory and writes the bytes", () => {
		const dir = join(tempDir("wechat-media-"), "nested");
		const path = saveMedia(dir, "photo.jpg", Buffer.from([1, 2, 3]));
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path)).toEqual(Buffer.from([1, 2, 3]));
	});
});
