/**
 * The media helpers the bridge never reaches through a message of its own: the
 * sniff that names an inbound file's type for the line a turn is handed.
 */

import { describe, expect, test } from "bun:test";
import { sniffFileMime } from "./media.ts";

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
