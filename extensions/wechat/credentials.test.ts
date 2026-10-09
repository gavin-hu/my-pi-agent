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

function newPath(): string {
	return join(tempDir("wechat-cred-"), "credentials.json");
}

describe("credentials", () => {
	test("round-trips an account keyed by bot id", () => {
		const path = newPath();
		saveAccount(account, path);
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
		expect(readCredentials(path).accounts).toEqual({});
	});

	test.skipIf(process.platform === "win32")("writes the file with 0600", () => {
		const path = newPath();
		writeCredentials(path, { accounts: { b1: account } });
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});
});
