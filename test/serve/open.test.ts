import { describe, expect, test } from "bun:test";
import { browserCommand, openInBrowser } from "../../extensions/serve/open.ts";

describe("browserCommand", () => {
	test("uses start on Windows", () => {
		expect(browserCommand("http://x/", "win32")).toEqual({ command: "cmd", args: ["/c", "start", "", "http://x/"] });
	});

	test("uses open on macOS", () => {
		expect(browserCommand("http://x/", "darwin")).toEqual({ command: "open", args: ["http://x/"] });
	});

	test("uses xdg-open elsewhere", () => {
		expect(browserCommand("http://x/", "linux")).toEqual({ command: "xdg-open", args: ["http://x/"] });
	});
});

describe("openInBrowser", () => {
	test("spawns the platform command with the URL", () => {
		const calls: Array<[string, string[]]> = [];
		openInBrowser("http://x/", {
			platform: "linux",
			spawn: (command, args) => calls.push([command, args]),
		});
		expect(calls).toEqual([["xdg-open", ["http://x/"]]]);
	});

	test("ignores spawn failures", () => {
		expect(() =>
			openInBrowser("http://x/", {
				platform: "win32",
				spawn: () => {
					throw new Error("no browser");
				},
			}),
		).not.toThrow();
	});
});
