import { describe, expect, test } from "bun:test";
import {
	buildCurlArgs,
	createCurlPoster,
	CurlAbortError,
	CurlTimeoutError,
	CurlUnavailableError,
	parseCurlOutput,
	STATUS_MARKER,
	type ExecFileImpl,
	type HttpPostRequest,
} from "../../extensions/web-search/curl.ts";

const request: HttpPostRequest = {
	url: "https://html.duckduckgo.com/html/",
	headers: { "User-Agent": "UA", Accept: "text/html" },
	form: { q: "pi & agent", b: "", kl: "wt-wt", kp: "-1" },
	timeoutMs: 20_000,
};

describe("buildCurlArgs", () => {
	test("builds a shell-free POST argv with headers, form fields, and the status marker", () => {
		const args = buildCurlArgs(request);
		expect(args.slice(0, 2)).toEqual(["-sS", "-X"]);
		expect(args).toContain("POST");
		expect(args[args.indexOf("--max-time") + 1]).toBe("25");
		expect(args).toContain("--data-urlencode");
		expect(args).toContain("q=pi & agent");
		expect(args).toContain("kp=-1");
		expect(args).toContain("User-Agent: UA");
		expect(args).toContain(`\n${STATUS_MARKER}%{http_code}`);
		expect(args.at(-1)).toBe(request.url);
	});

	test("never places the url in a shell string", () => {
		const evil = buildCurlArgs({ ...request, url: "https://x/; rm -rf /" });
		expect(evil.at(-1)).toBe("https://x/; rm -rf /");
	});
});

describe("parseCurlOutput", () => {
	test("splits the body from the trailing status", () => {
		expect(parseCurlOutput(`<html>ok</html>\n${STATUS_MARKER}200`)).toEqual({ status: 200, body: "<html>ok</html>" });
	});

	test("uses the last marker so a body containing the marker still parses", () => {
		const output = `before ${STATUS_MARKER} fake\n${STATUS_MARKER}418`;
		expect(parseCurlOutput(output)).toEqual({ status: 418, body: `before ${STATUS_MARKER} fake` });
	});

	test("throws when the status marker is missing", () => {
		expect(() => parseCurlOutput("no marker here")).toThrow(CurlUnavailableError);
	});
});

describe("createCurlPoster", () => {
	test("runs curl and parses its output", async () => {
		let seenFile = "";
		let seenArgs: string[] = [];
		const exec: ExecFileImpl = (file, args) => {
			seenFile = file;
			seenArgs = args;
			return Promise.resolve({ stdout: `body\n${STATUS_MARKER}200`, stderr: "" });
		};
		const poster = createCurlPoster("curl", exec);
		const result = await poster(request);
		expect(seenFile).toBe("curl");
		expect(seenArgs).toEqual(buildCurlArgs(request));
		expect(result).toEqual({ status: 200, body: "body" });
	});

	test("maps a missing binary to CurlUnavailableError", async () => {
		const exec: ExecFileImpl = () => Promise.reject(Object.assign(new Error("spawn curl ENOENT"), { code: "ENOENT" }));
		await expect(createCurlPoster("/nope/curl", exec)(request)).rejects.toThrow(/binary was not found/);
	});

	test("surfaces curl stderr on failure", async () => {
		const exec: ExecFileImpl = () => Promise.reject(Object.assign(new Error("exit 7"), { stderr: "connection refused" }));
		await expect(createCurlPoster("curl", exec)(request)).rejects.toThrow(/connection refused/);
	});

	test("reports caller cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		const exec: ExecFileImpl = () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
		await expect(createCurlPoster("curl", exec)(request, controller.signal)).rejects.toThrow(CurlAbortError);
	});

	test("reports a timeout when curl hangs", async () => {
		const exec: ExecFileImpl = (_file, _args, options) =>
			new Promise((_resolve, reject) => {
				options.signal.addEventListener("abort", () => reject(new Error("killed")), { once: true });
			});
		await expect(createCurlPoster("curl", exec)({ ...request, timeoutMs: 10 })).rejects.toThrow(CurlTimeoutError);
	});
});
