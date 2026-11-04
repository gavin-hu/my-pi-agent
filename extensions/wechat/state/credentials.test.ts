/**
 * `credentials.json`: the one stored account, written `0600` by the shared atomic
 * JSON write, so a reader never sees a partial file.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../../test/helpers/env.ts";
import { account } from "../../../test/helpers/fixtures/wechat-bridge.ts";
import type { BotCredentials, CredentialsFile } from "../types.ts";
import {
	accountKey,
	clearCredentials,
	migrateCredentials,
	readCredentials,
	saveAccount,
	storedAccount,
	writeCredentials,
} from "./credentials.ts";

describe("credentials", () => {
	function newPath(): string {
		return join(tempDir("wechat-credentials-"), "credentials.json");
	}

	function bot(overrides: Partial<BotCredentials> = {}): BotCredentials {
		return { ...account, ilinkBotId: "bot-1", ...overrides };
	}

	test("a save leaves no temp behind and stores the one account", () => {
		const path = newPath();
		saveAccount(bot(), path);
		// The `0600` itself is proved by the mode case below, which skips on Windows,
		// where Node reports one mode for every file.
		expect(readdirSync(dirname(path))).toEqual(["credentials.json"]);
		expect(readCredentials(path).account).toEqual(bot());
	});

	test("a second save replaces the file in place", () => {
		const path = newPath();
		saveAccount(bot(), path);
		saveAccount(bot({ botToken: "t2", ilinkBotId: "bot-2" }), path);
		expect(readdirSync(dirname(path))).toEqual(["credentials.json"]);
		expect(readCredentials(path).account?.ilinkBotId).toBe("bot-2");
	});

	test("keys an account by its bot id, or by its user id without one", () => {
		expect(accountKey(bot())).toBe("bot-1");
		// The user id is the fallback, so a login response that named no bot id is
		// still something a session can bind to.
		expect(accountKey(bot({ ilinkBotId: "" }))).toBe(account.ilinkUserId);
	});

	test("a write that cannot serialize keeps the previous account", () => {
		const path = newPath();
		saveAccount(bot(), path);
		const before = readFileSync(path, "utf-8");
		// A BigInt is what the serializer refuses: the shape is never read, only written,
		// so the cast hides nothing, and nothing reaches the file.
		const unserializable = { account: { createdAt: 1n } } as unknown as CredentialsFile;
		expect(() => writeCredentials(path, unserializable)).toThrow();
		expect(readFileSync(path, "utf-8")).toBe(before);
		expect(readdirSync(dirname(path))).toEqual(["credentials.json"]);
	});
});

describe("stored credentials", () => {
	const second: BotCredentials = {
		botToken: "tok2",
		ilinkUserId: "other@im.wechat",
		ilinkBotId: "b2",
		baseUrl: "https://other",
		botAgent: "pi-wechat",
		createdAt: 6,
	};

	function newPath(): string {
		return join(tempDir("wechat-cred-"), "credentials.json");
	}

	test("round-trips the one stored account", () => {
		const path = newPath();
		saveAccount(account, path);
		expect(storedAccount(path)).toEqual(account);
	});

	test("a second login replaces the account instead of keeping both", () => {
		const path = newPath();
		saveAccount(account, path);
		saveAccount(second, path);
		expect(storedAccount(path)).toEqual(second);
		expect(readFileSync(path, "utf-8")).not.toContain('b2":');
	});

	test("reads an account map an older version wrote as the one it was polling", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ accounts: { b: account, b2: second }, activeAccount: "b2" }), "utf-8");
		expect(storedAccount(path)).toEqual(second);
	});

	test("falls back to the map's first entry for a file written before the pointer", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ accounts: { b: account, b2: second } }), "utf-8");
		expect(storedAccount(path)).toEqual(account);
	});

	test("ignores an active pointer that names no stored account", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ accounts: { b: account }, activeAccount: "gone" }), "utf-8");
		expect(storedAccount(path)).toEqual(account);
	});

	test("drops a malformed entry and takes the next one", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ accounts: { bad: { botToken: "" }, good: account } }), "utf-8");
		expect(storedAccount(path)).toEqual(account);
	});

	test("returns no account for a corrupt file", () => {
		const path = newPath();
		writeFileSync(path, "not json", "utf-8");
		expect(readCredentials(path)).toEqual({});
	});

	test("clears the account on logout", () => {
		const path = newPath();
		saveAccount(account, path);
		clearCredentials(path);
		expect(readCredentials(path)).toEqual({});
	});

	test("rewrites a legacy account map down to one account, once", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ accounts: { b: account, b2: second }, activeAccount: "b2" }), "utf-8");
		expect(migrateCredentials(path)).toBe(true);
		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ account: second });
		// The rewrite is not repeated: a second start finds nothing to drop.
		expect(migrateCredentials(path)).toBe(false);
	});

	test.skipIf(process.platform === "win32")("writes the file with mode 0600", () => {
		const path = newPath();
		writeCredentials(path, { account });
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});
});
