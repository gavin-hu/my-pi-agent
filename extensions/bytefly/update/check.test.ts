import { describe, expect, test } from "bun:test";
import {
	type FetchLike,
	fetchAvailableUpdates,
	fetchLatestVersion,
	LATEST_VERSION_URL,
	UPDATE_TIMEOUT_MS,
} from "./check.ts";
import type { PackageUpdate } from "./types.ts";

/** A fetch seam answering with a fixed status and body. */
function answering(ok: boolean, body: unknown, calls: string[] = []): FetchLike {
	return async (url, init) => {
		calls.push(url);
		expect(init.headers.accept).toBe("application/json");
		return { ok, json: async () => body };
	};
}

const UPDATES: PackageUpdate[] = [
	{ source: "@gavin-hu/my-pi-agent", displayName: "@gavin-hu/my-pi-agent", type: "npm", scope: "user" },
];

describe("fetchAvailableUpdates", () => {
	test("returns Pi's package list through the injected check", async () => {
		let seen: unknown;
		const list = await fetchAvailableUpdates({
			cwd: process.cwd(),
			agentDir: process.cwd(),
			projectTrusted: false,
			checkForAvailableUpdates: async (manager) => {
				seen = manager;
				return UPDATES;
			},
		});

		expect(list).toEqual(UPDATES);
		expect(seen).toBeDefined();
	});

	test("returns undefined when the check throws", async () => {
		const list = await fetchAvailableUpdates({
			cwd: process.cwd(),
			agentDir: process.cwd(),
			projectTrusted: false,
			checkForAvailableUpdates: async () => {
				throw new Error("npm unreachable");
			},
		});

		// Not `[]`: an empty list is a real "everything is current" answer.
		expect(list).toBeUndefined();
	});
});

describe("fetchLatestVersion", () => {
	test("reads the published version from the latest document", async () => {
		const calls: string[] = [];
		expect(await fetchLatestVersion({ fetch: answering(true, { version: "0.12.0" }, calls) })).toBe("0.12.0");
		expect(calls).toEqual([LATEST_VERSION_URL]);
	});

	test("normalises surrounding whitespace", async () => {
		expect(await fetchLatestVersion({ fetch: answering(true, { version: " 0.12.0 " }) })).toBe("0.12.0");
	});

	test("gives up on a non-ok status", async () => {
		expect(await fetchLatestVersion({ fetch: answering(false, { version: "0.12.0" }) })).toBeUndefined();
	});

	test("gives up on a body that is not JSON", async () => {
		const broken: FetchLike = async () => ({
			ok: true,
			json: async () => {
				throw new SyntaxError("Unexpected token < in JSON");
			},
		});
		expect(await fetchLatestVersion({ fetch: broken })).toBeUndefined();
	});

	test("gives up on a payload without a real version", async () => {
		for (const body of [{}, { version: 5 }, { version: "" }, { version: "latest" }, { version: "0.12.x" }, null]) {
			expect(await fetchLatestVersion({ fetch: answering(true, body) }), JSON.stringify(body)).toBeUndefined();
		}
	});

	test("gives up when the request itself fails", async () => {
		const failing: FetchLike = async () => {
			throw new TypeError("fetch failed");
		};
		expect(await fetchLatestVersion({ fetch: failing })).toBeUndefined();
	});

	test("abandons a request that outlives the timeout", async () => {
		const hanging: FetchLike = (_url, init) =>
			new Promise((_resolve, reject) => {
				init.signal.addEventListener("abort", () => reject(new Error("aborted")));
			});
		expect(await fetchLatestVersion({ fetch: hanging, timeoutMs: 5 })).toBeUndefined();
	});

	test("has a bounded default timeout", () => {
		expect(UPDATE_TIMEOUT_MS).toBeGreaterThan(0);
		expect(UPDATE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
	});
});
