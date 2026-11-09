/**
 * The media helpers the bridge never reaches through a message of its own: the key
 * decode a message's reference is opened with, the sniff that names an inbound file's
 * type for the line a turn is handed, and the name a repeat of that file is found by.
 */

import { createDecipheriv, createCipheriv } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { modeOfOwnerOnlyWrite, tempDir } from "../../../test/helpers/env.ts";
import { decodeMediaKey, findSavedFile, isPaddingFailure, savedFileName, saveMedia, sniffFileMime } from "./media.ts";

describe("the wire's media key", () => {
	/** The reference key, in the three shapes a sender or a peer writes it. */
	const raw = Buffer.from("00112233445566778899aabbccddeeff", "hex");

	test("reads all three encodings as the same 16 bytes", () => {
		// `image_item.aeskey` is the bare hex the reference prefers.
		expect(decodeMediaKey(raw.toString("hex"))).toEqual(raw);
		// `media.aes_key` is base64 of that hex string, which is what senders write.
		expect(decodeMediaKey(Buffer.from(raw.toString("hex")).toString("base64"))).toEqual(raw);
		// A peer may also send base64 of the raw 16 bytes.
		expect(decodeMediaKey(raw.toString("base64"))).toEqual(raw);
	});

	test("refuses a value that decodes to neither key", () => {
		expect(() => decodeMediaKey("abcd")).toThrow("not 16 bytes");
		expect(() => decodeMediaKey("z".repeat(32))).toThrow("not 16 bytes");
	});
});

describe("the file sniff", () => {
	test("names an image, a document container, and text by their bytes", () => {
		expect(sniffFileMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))).toBe("image/png");
		expect(sniffFileMime(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
		// OOXML (.docx, .xlsx, .pptx), ODF, and a plain archive are all ZIP containers.
		expect(sniffFileMime(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBe("application/zip");
		expect(sniffFileMime(Buffer.from([0x1f, 0x8b, 0x08]))).toBe("application/gzip");
		expect(sniffFileMime(Buffer.from("a,b\nc,d\n"))).toBe("text/plain");
		expect(sniffFileMime(Buffer.from("笔记\n"))).toBe("text/plain");
	});

	test("names nothing for a legacy OLE2 document or a binary", () => {
		// `.doc`, `.xls`, and `.ppt` share this header, so naming one MIME would be
		// wrong for the other two.
		expect(sniffFileMime(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBeUndefined();
		expect(sniffFileMime(Buffer.from([1, 2, 3]))).toBeUndefined();
		// Printable, but a control byte says it is not text a reader can show.
		expect(sniffFileMime(Buffer.from([0x07, 0x41, 0x42]))).toBeUndefined();
		// A control-free prefix over bytes that are not UTF-8 is not text either.
		expect(sniffFileMime(Buffer.from([0x41, 0xc3, 0x28]))).toBeUndefined();
	});
});

describe("the saved-file name", () => {
	const md5 = "9dc4d908b20126a18377dc042f9920f0";

	test("carries the content hash between the moment and the peer's name", () => {
		expect(savedFileName(1000, 2, md5, "rows.csv")).toBe(`1000-2-${md5}-rows.csv`);
		// Without a hash from the wire, the counter is the last segment this module owns.
		expect(savedFileName(1000, 2, undefined, "rows.csv")).toBe("1000-2-rows.csv");
	});

	test("finds the file saved under a hash, and nothing else", () => {
		const dir = tempDir("wechat-saved-");
		writeFileSync(join(dir, savedFileName(1000, 1, md5, "notes.txt")), "older");
		writeFileSync(join(dir, savedFileName(2000, 2, "ab".repeat(16), "notes.txt")), "other");
		writeFileSync(join(dir, "a-peer-named-the-file-" + md5 + "-x.txt"), "not ours");

		expect(findSavedFile(dir, md5)).toBe(join(dir, savedFileName(1000, 1, md5, "notes.txt")));
		expect(findSavedFile(dir, "cd".repeat(16))).toBeUndefined();
		// A name this module did not write is not a saved copy, however it reads.
		expect(findSavedFile(dir, undefined)).toBeUndefined();
		expect(findSavedFile(join(dir, "missing"), md5)).toBeUndefined();
	});
});

describe("a padding failure", () => {
	test("is the one error a key that never encrypted the bytes produces", () => {
		const key = Buffer.from("0123456789abcdef");
		const cipher = createCipheriv("aes-128-ecb", key, null);
		const bytes = Buffer.concat([cipher.update(Buffer.from("wechat media payload")), cipher.final()]);
		const decipher = createDecipheriv("aes-128-ecb", Buffer.from("fedcba9876543210"), null);
		const failure = (() => {
			try {
				decipher.update(bytes);
				decipher.final();
				return undefined;
			} catch (error) {
				return error;
			}
		})();

		expect(isPaddingFailure(failure)).toBe(true);
		expect(isPaddingFailure(new Error("missing AES key"))).toBe(false);
		expect(isPaddingFailure("error:1C800064")).toBe(false);
	});
});

describe("the saved media file", () => {
	test("writes the bytes under the name it is given", () => {
		const dir = tempDir("wechat-media-");
		const path = saveMedia(dir, "1-0-abc", new Uint8Array([1, 2, 3]));
		expect(path).toBe(join(dir, "1-0-abc"));
		expect(readFileSync(path)).toEqual(Buffer.from([1, 2, 3]));
	});

	test.skipIf(process.platform === "win32")("writes it owner-only, like the state it belongs to", () => {
		const dir = tempDir("wechat-media-");
		const path = saveMedia(dir, "1-0-abc", new Uint8Array([1]));
		const mode = statSync(path).mode & 0o777;
		const ownerOnly = modeOfOwnerOnlyWrite();
		expect(
			mode,
			`umask 0${process.umask().toString(8)}, probe 0${ownerOnly.toString(8)}, file 0${mode.toString(8)}`,
		).toBe(ownerOnly);
	});
});
