import { describe, expect, test } from "bun:test";
import { bomCharset, charsetOf, decodeBytes, decodeHtml, sniffHtmlCharset } from "./charset.ts";

/** "中文页面" in GBK. */
const GBK_TEXT = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xd2, 0xb3, 0xc3, 0xe6]);
/** "早茶" in GBK. */
const GBK_TEA = new Uint8Array([0xd4, 0xe7, 0xb2, 0xe8]);

function ascii(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function joined(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		merged.set(part, offset);
		offset += part.length;
	}
	return merged;
}

describe("charsetOf", () => {
	test("reads the declared charset", () => {
		expect(charsetOf("text/html; charset=utf-8")).toBe("utf-8");
		expect(charsetOf("text/html;charset=gbk")).toBe("gbk");
		expect(charsetOf('text/html; charset="GBK"')).toBe("gbk");
		expect(charsetOf("text/html; charset = GB18030")).toBe("gb18030");
	});

	test("returns undefined when no charset is declared", () => {
		expect(charsetOf("text/html")).toBeUndefined();
		expect(charsetOf("")).toBeUndefined();
	});
});

describe("bomCharset", () => {
	test("recognises the three byte-order marks", () => {
		expect(bomCharset(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("utf-8");
		expect(bomCharset(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe("utf-16le");
		expect(bomCharset(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe("utf-16be");
	});

	test("returns undefined without a BOM", () => {
		expect(bomCharset(ascii("<html>"))).toBeUndefined();
	});
});

describe("sniffHtmlCharset", () => {
	test("reads <meta charset>", () => {
		expect(sniffHtmlCharset(ascii('<html><head><meta charset="gbk">'))).toBe("gbk");
		expect(sniffHtmlCharset(ascii("<html><head><meta charset=GB2312>"))).toBe("gb2312");
	});

	test("reads the http-equiv form", () => {
		const html = '<meta http-equiv="Content-Type" content="text/html; charset=gbk">';
		expect(sniffHtmlCharset(ascii(html))).toBe("gbk");
	});

	test("returns undefined when the document declares nothing", () => {
		expect(sniffHtmlCharset(ascii("<html><head><title>x</title></head></html>"))).toBeUndefined();
	});
});

describe("decodeBytes", () => {
	test("defaults to UTF-8", () => {
		expect(decodeBytes(ascii("hello"))).toBe("hello");
		expect(decodeBytes(ascii("广州早茶"))).toBe("广州早茶");
	});

	test("decodes a declared legacy charset", () => {
		expect(decodeBytes(GBK_TEXT, "gbk")).toBe("中文页面");
	});

	test("falls back to UTF-8 for an unknown label", () => {
		expect(decodeBytes(ascii("hello"), "not-a-charset")).toBe("hello");
	});
});

describe("decodeHtml", () => {
	test("honours the header charset", () => {
		expect(decodeHtml(GBK_TEXT, "text/html; charset=gbk")).toBe("中文页面");
	});

	test("falls back to the document's own <meta charset>", () => {
		const body = joined(
			ascii('<html><head><meta charset="gbk"></head><body><p>'),
			GBK_TEA,
			ascii("</p></body></html>"),
		);
		expect(decodeHtml(body, "text/html")).toContain("早茶");
	});

	test("prefers a byte-order mark over the declared charset", () => {
		const body = joined(new Uint8Array([0xef, 0xbb, 0xbf]), ascii("héllo"));
		expect(decodeHtml(body, "text/html; charset=gbk")).toBe("héllo");
	});

	test("prefers the declared charset over <meta>", () => {
		const body = joined(ascii('<html><head><meta charset="utf-8"></head><body>'), GBK_TEXT, ascii("</body></html>"));
		expect(decodeHtml(body, "text/html; charset=gbk")).toContain("中文页面");
	});
});
