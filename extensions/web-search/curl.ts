/**
 * HTTP transport for the web-search extension.
 *
 * Requests are sent with the `curl` binary rather than `fetch`. DuckDuckGo's
 * anti-bot layer challenges Node/Bun fetch clients (HTTP 202 "select all ducks")
 * but serves the same POST from curl, so curl is the reliable client here. The
 * request is built as an argv array and run with `execFile`, so nothing goes
 * through a shell and the query cannot be interpreted as a command.
 *
 * `HttpPoster` is the seam tests use to avoid both the network and subprocesses.
 */

import { execFile } from "node:child_process";

/** A form POST to send. */
export interface HttpPostRequest {
	url: string;
	headers: Record<string, string>;
	/** Fields sent as an `application/x-www-form-urlencoded` body. */
	form: Record<string, string>;
	timeoutMs: number;
}

export interface HttpPostResult {
	status: number;
	body: string;
}

/** Sends one form POST; the default implementation shells out to curl. */
export type HttpPoster = (request: HttpPostRequest, signal?: AbortSignal) => Promise<HttpPostResult>;

/** Marker curl appends after the body via `-w`, used to recover the status. */
export const STATUS_MARKER = "__PI_WEB_SEARCH_STATUS__";

const MAX_BUFFER_BYTES = 20 * 1024 * 1024;

export class CurlTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Search timed out after ${timeoutMs}ms.`);
		this.name = "CurlTimeoutError";
	}
}

export class CurlAbortError extends Error {
	constructor() {
		super("Search aborted.");
		this.name = "CurlAbortError";
	}
}

export class CurlUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CurlUnavailableError";
	}
}

/** Build the curl argv for a form POST. Exported for tests. */
export function buildCurlArgs(request: HttpPostRequest): string[] {
	const args = [
		"-sS",
		"-X",
		"POST",
		// Backstop for the in-process deadline; the signal normally wins.
		"--max-time",
		String(Math.ceil(request.timeoutMs / 1000) + 5),
		"-o",
		"-",
		"-w",
		`\n${STATUS_MARKER}%{http_code}`,
	];
	for (const [name, value] of Object.entries(request.headers)) args.push("-H", `${name}: ${value}`);
	for (const [name, value] of Object.entries(request.form)) args.push("--data-urlencode", `${name}=${value}`);
	args.push(request.url);
	return args;
}

/** Split curl's stdout into the HTTP status and the body. */
export function parseCurlOutput(raw: string): HttpPostResult {
	const at = raw.lastIndexOf(STATUS_MARKER);
	if (at < 0) throw new CurlUnavailableError("curl produced no status line.");
	const body = raw.slice(0, at).replace(/\n$/, "");
	const status = Number.parseInt(raw.slice(at + STATUS_MARKER.length).trim(), 10);
	if (!Number.isFinite(status)) throw new CurlUnavailableError("curl produced an unreadable status.");
	return { status, body };
}

export interface ExecFileResult {
	stdout: string;
	stderr: string;
}

export type ExecFileImpl = (
	file: string,
	args: string[],
	options: { signal: AbortSignal; maxBuffer: number },
) => Promise<ExecFileResult>;

const defaultExecFile: ExecFileImpl = (file, args, options) =>
	new Promise((resolve, reject) => {
		execFile(file, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
			if (error) reject(Object.assign(error, { stdout, stderr }));
			else resolve({ stdout, stderr });
		});
	});

/**
 * Create a poster that runs `curl` for each request.
 *
 * `execFileImpl` is injectable so tests can assert the argv and output parsing.
 */
export function createCurlPoster(curlPath = "curl", execFileImpl: ExecFileImpl = defaultExecFile): HttpPoster {
	return async (request, signal) => {
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

		let stdout: string;
		try {
			const result = await execFileImpl(curlPath, buildCurlArgs(request), {
				signal: controller.signal,
				maxBuffer: MAX_BUFFER_BYTES,
			});
			stdout = result.stdout;
		} catch (error) {
			if (timedOut) throw new CurlTimeoutError(request.timeoutMs);
			if (signal?.aborted) throw new CurlAbortError();
			const failure = error as { code?: string; stderr?: string; message?: string };
			if (failure.code === "ENOENT") {
				throw new CurlUnavailableError(
					`The "${curlPath}" binary was not found. Install curl or set "curlPath" in web-search.json.`,
				);
			}
			const detail = (failure.stderr || failure.message || String(error)).trim().slice(0, 300);
			throw new CurlUnavailableError(`curl failed: ${detail}`);
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}

		return parseCurlOutput(stdout);
	};
}
