import { describe, expect, test } from "bun:test";
import { type ExecLike, fetchAvailableUpdates, fetchOwnLatestVersion, UPDATE_TIMEOUT_MS } from "./check.ts";
import type { PackageUpdate } from "./types.ts";

const UPDATES: PackageUpdate[] = [
	{ source: "@gavin-hu/my-pi-agent", displayName: "@gavin-hu/my-pi-agent", type: "npm", scope: "user" },
];

/** A base dependency set; each test overrides only what it exercises. */
function deps(overrides: Record<string, unknown> = {}) {
	return {
		cwd: process.cwd(),
		agentDir: process.cwd(),
		projectTrusted: false,
		...overrides,
	};
}

describe("fetchAvailableUpdates", () => {
	test("returns Pi's package list through the injected check", async () => {
		let seen: unknown;
		const list = await fetchAvailableUpdates(
			deps({
				checkForAvailableUpdates: async (manager: unknown) => {
					seen = manager;
					return UPDATES;
				},
			}),
		);

		expect(list).toEqual(UPDATES);
		expect(seen).toBeDefined();
	});

	test("returns an empty list when the check throws", async () => {
		const list = await fetchAvailableUpdates(
			deps({
				checkForAvailableUpdates: async () => {
					throw new Error("npm unreachable");
				},
			}),
		);

		expect(list).toEqual([]);
	});
});

describe("fetchOwnLatestVersion", () => {
	test("asks the configured npm command for this package's latest version", async () => {
		const calls: Array<{ command: string; args: string[]; timeout?: number }> = [];
		const exec: ExecLike = async (command, args, options) => {
			calls.push({ command, args, timeout: options?.timeout });
			return { stdout: '"0.14.0"\n', code: 0 };
		};

		const version = await fetchOwnLatestVersion(
			deps({ npmCommand: ["pnpm", "--silent"], exec }),
			"@gavin-hu/my-pi-agent",
		);

		expect(version).toBe("0.14.0");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("pnpm");
		expect(calls[0]?.args).toEqual(["--silent", "view", "@gavin-hu/my-pi-agent@latest", "version", "--json"]);
		expect(calls[0]?.timeout).toBe(UPDATE_TIMEOUT_MS);
	});

	test("defaults to npm", async () => {
		let command = "";
		const exec: ExecLike = async (value) => {
			command = value;
			return { stdout: '"0.14.0"', code: 0 };
		};

		await fetchOwnLatestVersion(deps({ exec }), "@gavin-hu/my-pi-agent");

		expect(command).toBe("npm");
	});

	test("gives up on a non-zero exit", async () => {
		const exec: ExecLike = async () => ({ stdout: '"0.14.0"', code: 1 });

		expect(await fetchOwnLatestVersion(deps({ exec }), "@gavin-hu/my-pi-agent")).toBeUndefined();
	});

	test("gives up on output that is not a version", async () => {
		for (const stdout of ["", "latest", '"0.14.x"', "{}", '[{"bad":true}]']) {
			const exec: ExecLike = async () => ({ stdout, code: 0 });
			expect(await fetchOwnLatestVersion(deps({ exec }), "@gavin-hu/my-pi-agent"), stdout).toBeUndefined();
		}
	});

	test("gives up when the command throws", async () => {
		const exec: ExecLike = async () => {
			throw new Error("npm missing");
		};

		expect(await fetchOwnLatestVersion(deps({ exec }), "@gavin-hu/my-pi-agent")).toBeUndefined();
	});
});
