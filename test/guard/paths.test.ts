import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, normalizeConfig } from "../../extensions/guard/config.ts";
import { decidePath, globToRegExp, matchProtectedPath, resolveInput, toMatchPath } from "../../extensions/guard/paths.ts";

describe("globToRegExp", () => {
	test("matches a bare filename at any depth", () => {
		const re = globToRegExp(".env");
		expect(re.test(".env")).toBe(true);
		expect(re.test("sub/.env")).toBe(true);
		expect(re.test(".env.local")).toBe(false);
	});

	test("matches a wildcard suffix", () => {
		const re = globToRegExp(".env.*");
		expect(re.test(".env.local")).toBe(true);
		expect(re.test("sub/.env.production")).toBe(true);
	});

	test("matches a doublestar directory pattern", () => {
		const re = globToRegExp("**/node_modules/**");
		expect(re.test("node_modules/pkg/index.js")).toBe(true);
		expect(re.test("a/b/node_modules/c")).toBe(true);
		expect(re.test("a/src/index.js")).toBe(false);
	});

	test("anchors patterns that contain a slash", () => {
		const re = globToRegExp(".git/config");
		expect(re.test(".git/config")).toBe(true);
		expect(re.test("sub/.git/config")).toBe(false);
	});
});

describe("matchProtectedPath", () => {
	test("the last match wins so ! re-allows", () => {
		const patterns = [".env", ".env.*", "!.env.example"];
		expect(matchProtectedPath(".env", patterns).protected).toBe(true);
		expect(matchProtectedPath(".env.production", patterns).protected).toBe(true);
		expect(matchProtectedPath(".env.example", patterns).protected).toBe(false);
	});
});

describe("toMatchPath", () => {
	test("returns a posix path relative to the cwd", () => {
		expect(toMatchPath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
	});

	test("falls back to the absolute path outside the cwd", () => {
		expect(toMatchPath("/other/.env", "/repo")).toBe("/other/.env");
	});
});

describe("decidePath", () => {
	const cwd = "/repo";

	test("blocks a protected file", () => {
		const decision = decidePath(resolveInput(cwd, ".env"), cwd, DEFAULT_CONFIG);
		expect(decision?.action).toBe("block");
		expect(decision?.pattern).toBe(".env");
	});

	test("blocks .git, keys, lockfiles, and node_modules", () => {
		for (const path of [".git/config", "certs/key.pem", "bun.lock", "a/node_modules/b", "~/.ssh/id_rsa"]) {
			expect(decidePath(resolveInput(cwd, path), cwd, DEFAULT_CONFIG)).toBeDefined();
		}
	});

	test("allows a negated example file and ordinary source", () => {
		expect(decidePath(resolveInput(cwd, ".env.example"), cwd, DEFAULT_CONFIG)).toBeUndefined();
		expect(decidePath(resolveInput(cwd, "src/index.ts"), cwd, DEFAULT_CONFIG)).toBeUndefined();
	});

	test("honours the configured action", () => {
		const config = normalizeConfig({ protected: { action: "confirm" } });
		expect(decidePath(resolveInput(cwd, ".env"), cwd, config)?.action).toBe("confirm");
	});

	test("does nothing when the pattern list is empty", () => {
		const config = normalizeConfig({ protected: { paths: [] } });
		expect(decidePath(resolveInput(cwd, ".env"), cwd, config)).toBeUndefined();
	});
});
