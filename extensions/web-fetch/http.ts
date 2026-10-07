/**
 * Native-fetch HTTP transport for the web-search extension.
 *
 * No `curl`, no dependencies: one `fetch` call with a combined caller-signal and
 * timeout, optional request body, and a size cap. `HttpRunner` is the seam tests
 * use to avoid the network.
 */

/** A request to send. */
export interface HttpRequest {
	url: string;
	method?: "GET" | "POST";
	headers?: Record<string, string>;
	/** Raw request body (for example a JSON-RPC payload). */
	body?: string;
	timeoutMs: number;
	/** Maximum response size in bytes; larger responses raise `HttpTooLargeError`. */
	maxBytes?: number;
}

export interface HttpResponse {
	status: number;
	body: string;
	contentType: string;
	finalUrl: string;
	sizeBytes: number;
}

export type HttpRunner = (request: HttpRequest, signal?: AbortSignal) => Promise<HttpResponse>;

export class HttpTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Request timed out after ${timeoutMs}ms.`);
		this.name = "HttpTimeoutError";
	}
}

export class HttpAbortError extends Error {
	constructor() {
		super("Request aborted.");
		this.name = "HttpAbortError";
	}
}

export class HttpTooLargeError extends Error {
	constructor(maxBytes: number) {
		super(`Response exceeded the ${maxBytes}-byte limit.`);
		this.name = "HttpTooLargeError";
	}
}

export class HttpUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HttpUnavailableError";
	}
}

/**
 * Create a runner backed by `fetch`.
 *
 * `fetchImpl` is injectable so tests never touch the network.
 */
export function createFetchRunner(fetchImpl: typeof fetch = globalThis.fetch): HttpRunner {
	return async (request, signal) => {
		if (typeof fetchImpl !== "function") {
			throw new HttpUnavailableError("No fetch implementation is available in this runtime.");
		}
		if (signal?.aborted) throw new HttpAbortError();

		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, request.timeoutMs);
		const onAbort = () => controller.abort();
		if (signal) {
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}

		try {
			const response = await fetchImpl(request.url, {
				method: request.method ?? "GET",
				headers: request.headers,
				body: request.body,
				signal: controller.signal,
				redirect: "follow",
			});

			const contentType = response.headers.get("content-type") ?? "";
			const finalUrl = response.url || request.url;
			const declared = Number(response.headers.get("content-length"));
			if (request.maxBytes !== undefined && Number.isFinite(declared) && declared > request.maxBytes) {
				throw new HttpTooLargeError(request.maxBytes);
			}

			const body = await response.text();
			const sizeBytes = new TextEncoder().encode(body).length;
			if (request.maxBytes !== undefined && sizeBytes > request.maxBytes) {
				throw new HttpTooLargeError(request.maxBytes);
			}

			return { status: response.status, body, contentType, finalUrl, sizeBytes };
		} catch (error) {
			if (timedOut) throw new HttpTimeoutError(request.timeoutMs);
			if (signal?.aborted) throw new HttpAbortError();
			if (error instanceof HttpTooLargeError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throw new HttpUnavailableError(`Request failed: ${message}`);
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}
	};
}
