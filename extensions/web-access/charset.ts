/**
 * Charset-aware body decoding shared by the web-access halves.
 *
 * HTTP lets a response name its encoding in `Content-Type`, and an HTML page can
 * name one in its markup, so decoding every body as UTF-8 turns a GBK/GB18030
 * page into replacement characters. `http.ts` honours the BOM and the declared
 * charset; `page.ts` adds the `<meta charset>` fallback for HTML. An unknown
 * label falls back to UTF-8 instead of failing the fetch.
 */

const FALLBACK_CHARSET = "utf-8";

/** How much of an HTML document is scanned for a `<meta charset>` declaration. */
const SNIFF_BYTES = 4096;

/** The `charset` parameter of a content type, lowercased. */
export function charsetOf(contentType: string): string | undefined {
	const match = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
	return match?.[1]?.toLowerCase();
}

/** The charset a leading byte-order mark declares. */
export function bomCharset(bytes: Uint8Array): string | undefined {
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
	return undefined;
}

/**
 * The charset a document declares in its first few kilobytes. Both
 * `<meta charset="gbk">` and `<meta http-equiv="content-type" content="text/html; charset=gbk">`
 * are matched by the same `charset=` scan.
 */
export function sniffHtmlCharset(bytes: Uint8Array): string | undefined {
	// Latin-1 keeps every byte addressable and ASCII tags intact.
	const head = new TextDecoder("latin1").decode(bytes.subarray(0, SNIFF_BYTES));
	const match = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_.:-]+)/i.exec(head);
	return match?.[1]?.toLowerCase();
}

/** The label type `TextDecoder` accepts; a runtime label is validated by the constructor. */
type DecoderLabel = ConstructorParameters<typeof TextDecoder>[0];

/** Decode bytes with `charset`, falling back to UTF-8 for an absent or unknown label. */
export function decodeBytes(bytes: Uint8Array, charset?: string): string {
	if (!charset) return new TextDecoder(FALLBACK_CHARSET).decode(bytes);
	try {
		return new TextDecoder(charset as DecoderLabel).decode(bytes);
	} catch {
		return new TextDecoder(FALLBACK_CHARSET).decode(bytes);
	}
}

/** Decode an HTML body: BOM first, then the declared charset, then its own `<meta>`, then UTF-8. */
export function decodeHtml(bytes: Uint8Array, contentType: string): string {
	return decodeBytes(bytes, bomCharset(bytes) ?? charsetOf(contentType) ?? sniffHtmlCharset(bytes));
}
