import type { HttpResponse } from "../../../extensions/web-access/http.ts";

/** A JSON `HttpResponse`, for a fake runner. */
export function jsonResponse(body: unknown, status = 200): HttpResponse {
	const text = typeof body === "string" ? body : JSON.stringify(body);
	return {
		status,
		body: text,
		contentType: "application/json",
		finalUrl: "https://example.com/",
		sizeBytes: text.length,
	};
}

/** An HTML `HttpResponse`, for a fake runner. */
export function htmlResponse(body: string, finalUrl = "https://example.com/"): HttpResponse {
	return { status: 200, body, contentType: "text/html; charset=utf-8", finalUrl, sizeBytes: body.length };
}

/** Several byte slices as one, the way a response body arrives in chunks. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		merged.set(part, offset);
		offset += part.length;
	}
	return merged;
}
