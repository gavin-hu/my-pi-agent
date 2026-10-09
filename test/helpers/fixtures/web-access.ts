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
