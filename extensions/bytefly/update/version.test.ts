import { describe, expect, test } from "bun:test";
import { isNewerVersion, parseVersion } from "./version.ts";

describe("parseVersion", () => {
	test("reads a plain and a partial core, filling the missing segments with 0", () => {
		expect(parseVersion("1.2.3")).toEqual({ core: [1, 2, 3], pre: [] });
		expect(parseVersion("1.2")).toEqual({ core: [1, 2, 0], pre: [] });
		expect(parseVersion("1")).toEqual({ core: [1, 0, 0], pre: [] });
	});

	test("tolerates a leading v and surrounding whitespace", () => {
		expect(parseVersion(" v0.11.4 ")).toEqual({ core: [0, 11, 4], pre: [] });
	});

	test("keeps the prerelease and drops build metadata", () => {
		expect(parseVersion("0.12.0-beta.1+build.5")).toEqual({ core: [0, 12, 0], pre: ["beta", "1"] });
	});

	test("rejects anything that is not a version", () => {
		for (const value of ["", "latest", "*", "1.2.x", "1..2", "1.2.3-", "1.2.3-..", "v", "1.2.3.4", "-1.2.3"]) {
			expect(parseVersion(value), value).toBeUndefined();
		}
	});
});

describe("isNewerVersion", () => {
	test("orders the core numerically, not lexically", () => {
		expect(isNewerVersion("0.12.0", "0.11.4")).toBe(true);
		expect(isNewerVersion("0.11.10", "0.11.9")).toBe(true);
		expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
		expect(isNewerVersion("0.11.4", "0.12.0")).toBe(false);
		expect(isNewerVersion("0.10.0", "0.11.4")).toBe(false);
	});

	test("treats the same version as no upgrade, regardless of notation", () => {
		expect(isNewerVersion("0.11.4", "0.11.4")).toBe(false);
		expect(isNewerVersion("v0.11.4", "0.11.4")).toBe(false);
		expect(isNewerVersion("0.11.4+build.2", "0.11.4")).toBe(false);
	});

	test("ranks a prerelease below its release and above the previous one", () => {
		expect(isNewerVersion("0.12.0", "0.12.0-beta.2")).toBe(true);
		expect(isNewerVersion("0.12.0-beta.2", "0.12.0")).toBe(false);
		expect(isNewerVersion("0.12.0-beta.2", "0.11.4")).toBe(true);
	});

	test("orders prerelease identifiers by semver's rules", () => {
		expect(isNewerVersion("0.12.0-beta.2", "0.12.0-beta.1")).toBe(true);
		expect(isNewerVersion("0.12.0-beta.10", "0.12.0-beta.9")).toBe(true);
		expect(isNewerVersion("0.12.0-beta", "0.12.0-alpha")).toBe(true);
		expect(isNewerVersion("0.12.0-alpha.1", "0.12.0-alpha")).toBe(true);
		expect(isNewerVersion("0.12.0-alpha.beta", "0.12.0-alpha.1")).toBe(true);
		expect(isNewerVersion("0.12.0-rc.1", "0.12.0-beta.11")).toBe(true);
	});

	test("never announces an upgrade from a payload that does not parse", () => {
		expect(isNewerVersion("latest", "0.11.4")).toBe(false);
		expect(isNewerVersion("", "0.11.4")).toBe(false);
		expect(isNewerVersion("0.12.0", "")).toBe(false);
		expect(isNewerVersion("0.12.0", "not-a-version")).toBe(false);
	});
});
