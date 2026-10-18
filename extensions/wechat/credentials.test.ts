import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { clearCredentials, primaryAccount, readCredentials, saveAccount, writeCredentials } from "./credentials.ts";
import type { BotCredentials } from "./types.ts";

const account: BotCredentials = {
	botToken: "tok",
	ilinkUserId: "u@im.wechat",
	ilinkBotId: "b1",
	baseUrl: "https://base",
	botAgent: "pi-wechat",
	createdAt: 5,
};

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

describe("credentials", () => {
	test("round-trips an account keyed by bot id", () => {
		const path = newPath();
		saveAccount(account, path);
		expect(primaryAccount(path)).toEqual(account);
	});

	test("makes the last confirmed login the active account", () => {
		const path = newPath();
		saveAccount(account, path);
		saveAccount(second, path);
		// Both stay stored (multi-account), but the bridge must run the new one.
		expect(Object.keys(readCredentials(path).accounts)).toEqual(["b1", "b2"]);
		expect(primaryAccount(path)).toEqual(second);
	});

	test("switches to an account that is not the first stored one", () => {
		const third: BotCredentials = { ...account, ilinkBotId: "b3", ilinkUserId: "third@im.wechat" };
		const path = newPath();
		saveAccount(account, path);
		saveAccount(second, path);
		saveAccount(third, path);
		saveAccount(second, path);
		// The first account is not the one that just logged in, so a first-only read
		// would still return `account` here.
		expect(primaryAccount(path)).toEqual(second);
	});

	test("falls back to the first account for a file written before activeAccount", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ accounts: { b1: account, b2: second } }), "utf-8");
		expect(readCredentials(path).activeAccount).toBeUndefined();
		expect(primaryAccount(path)).toEqual(account);
	});

	test("ignores an active pointer to an account that is not stored", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ accounts: { b1: account }, activeAccount: "gone" }), "utf-8");
		expect(readCredentials(path).activeAccount).toBeUndefined();
		expect(primaryAccount(path)).toEqual(account);
	});

	test("drops malformed entries on read", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ accounts: { bad: { botToken: "" }, good: account } }), "utf-8");
		expect(primaryAccount(path)).toEqual(account);
		expect(Object.keys(readCredentials(path).accounts)).toEqual(["good"]);
	});

	test("returns no accounts for a corrupt file", () => {
		const path = newPath();
		writeFileSync(path, "not json", "utf-8");
		expect(readCredentials(path).accounts).toEqual({});
	});

	test("clears every account", () => {
		const path = newPath();
		saveAccount(account, path);
		clearCredentials(path);
		expect(readCredentials(path)).toEqual({ accounts: {} });
	});

	test.skipIf(process.platform === "win32")("writes the file with 0600", () => {
		const path = newPath();
		writeCredentials(path, { accounts: { b1: account } });
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});
});
