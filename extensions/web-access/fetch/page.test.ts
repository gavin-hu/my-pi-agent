import { describe, expect, test } from "bun:test";
import { DEFAULT_FETCH_CONFIG } from "./config.ts";
import type { HttpResponse, HttpRunner } from "../http.ts";
import { runFetch } from "./page.ts";
import type { PdfExtractor } from "./pdf.ts";
import type { FetchRequest } from "./types.ts";

const config = { ...DEFAULT_FETCH_CONFIG, timeoutMs: 5000 };

function baseRequest(overrides: Partial<FetchRequest> = {}): FetchRequest {
	return {
		url: "https://1.1.1.1/start",
		method: "GET",
		headers: {},
		startIndex: 0,
		maxChars: 5000,
		find: [],
		mode: "insensitive",
		contextChars: 200,
		maxMatches: 8,
		refresh: false,
		cacheable: true,
		...overrides,
	};
}

function redirect(location: string, status = 302): HttpResponse {
	return {
		status,
		body: "",
		contentType: "text/html",
		finalUrl: "https://1.1.1.1/start",
		sizeBytes: 0,
		location,
	};
}

function html(body = "<article><p>next</p></article>"): HttpResponse {
	return { status: 200, body, contentType: "text/html", finalUrl: "https://1.1.1.1/next", sizeBytes: body.length };
}

function pdfResponse(): HttpResponse {
	const bytes = new Uint8Array([37, 80, 68, 70]);
	return {
		status: 200,
		body: "%PDF",
		contentType: "application/pdf",
		finalUrl: "https://1.1.1.1/file.pdf",
		sizeBytes: bytes.length,
		bytes,
	};
}

describe("runFetch redirects", () => {
	test("follows a redirect to a public address", async () => {
		const seen: string[] = [];
		const runner: HttpRunner = (req) => {
			seen.push(req.url);
			return Promise.resolve(req.url.endsWith("/start") ? redirect("https://1.1.1.1/next") : html());
		};
		const page = await runFetch("https://1.1.1.1/start", baseRequest(), config, undefined, { http: runner });
		expect(seen).toEqual(["https://1.1.1.1/start", "https://1.1.1.1/next"]);
		expect(page.text).toContain("next");
	});

	test("refuses a redirect to a private address", async () => {
		const runner: HttpRunner = () => Promise.resolve(redirect("http://169.254.169.254/latest/meta-data"));
		await expect(runFetch("https://1.1.1.1/start", baseRequest(), config, undefined, { http: runner })).rejects.toThrow(
			/internal/,
		);
	});

	test("throws when there are too many redirects", async () => {
		const runner: HttpRunner = () => Promise.resolve(redirect("https://1.1.1.1/loop"));
		await expect(runFetch("https://1.1.1.1/start", baseRequest(), config, undefined, { http: runner })).rejects.toThrow(
			/Too many redirects/,
		);
	});

	test("rewrites a 303 POST to a bodyless GET", async () => {
		const calls: Array<{ method?: string; body?: string }> = [];
		const runner: HttpRunner = (req) => {
			calls.push({ method: req.method, body: req.body });
			return Promise.resolve(calls.length === 1 ? redirect("https://1.1.1.1/result", 303) : html());
		};
		await runFetch("https://1.1.1.1/start", baseRequest({ method: "POST", body: "a=1" }), config, undefined, {
			http: runner,
		});
		expect(calls[0]).toEqual({ method: "POST", body: "a=1" });
		expect(calls[1]).toEqual({ method: "GET", body: undefined });
	});

	test("passes POST body and custom headers, keeping the config headers", async () => {
		let received: Parameters<HttpRunner>[0] | undefined;
		const runner: HttpRunner = (req) => {
			received = req;
			return Promise.resolve(html());
		};
		await runFetch(
			"https://1.1.1.1/start",
			baseRequest({ method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }),
			config,
			undefined,
			{ http: runner },
		);
		expect(received?.method).toBe("POST");
		expect(received?.body).toBe("{}");
		expect(received?.headers?.["Content-Type"]).toBe("application/json");
		expect(received?.headers?.["User-Agent"]).toBe(config.userAgent);
		expect(received?.redirect).toBe("manual");
	});
});

describe("runFetch PDF", () => {
	const runner: HttpRunner = () => Promise.resolve(pdfResponse());

	test("extracts PDF text with the injected extractor", async () => {
		const pdf: PdfExtractor = async () => "PDF body";
		const page = await runFetch("https://1.1.1.1/file.pdf", baseRequest(), config, undefined, { http: runner, pdf });
		expect(page.text).toBe("PDF body");
	});

	test("falls back to a note when extraction fails", async () => {
		const pdf: PdfExtractor = async () => {
			throw new Error("no unpdf");
		};
		const page = await runFetch("https://1.1.1.1/file.pdf", baseRequest(), config, undefined, { http: runner, pdf });
		expect(page.text).toContain("PDF text extraction failed");
		expect(page.text).toContain("no unpdf");
	});

	test("returns the binary note when PDF is disabled", async () => {
		const page = await runFetch(
			"https://1.1.1.1/file.pdf",
			baseRequest(),
			{ ...config, pdfEnabled: false },
			undefined,
			{ http: runner },
		);
		expect(page.text).toContain("binary content");
	});
});
