/**
 * `credentials.json`: one entry per bot account, written `0600` by the shared
 * atomic JSON write, so a reader never sees a partial file.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../../test/helpers/env.ts";
import { account } from "../../../test/helpers/fixtures/wechat-bridge.ts";
import type { BotCredentials, CredentialsFile } from "../types.ts";
import { readCredentials, saveAccount, writeCredentials } from "./credentials.ts";

describe("credentials", () => {
	function newPath(): string {
		return join(tempDir("wechat-credentials-"), "credentials.json");
	}

	function bot(overrides: Partial<BotCredentials> = {}): BotCredentials {
		return { ...account, ilinkBotId: "bot-1", ...overrides };
	}

	test("a save leaves no temp behind and points at the saved account", () => {
		const path = newPath();
		saveAccount(bot(), path);
		// The `0600` itself is proved by transport/client.test.ts, which already calls
		// this writer and skips on Windows, where Node reports one mode for every file.
		expect(readdirSync(dirname(path))).toEqual(["credentials.json"]);
		expect(readCredentials(path).activeAccount).toBe("bot-1");
	});

	test("a second save replaces the file in place", () => {
		const path = newPath();
		saveAccount(bot(), path);
		saveAccount(bot({ botToken: "t2", ilinkBotId: "bot-2" }), path);
		expect(readdirSync(dirname(path))).toEqual(["credentials.json"]);
		expect(Object.keys(readCredentials(path).accounts)).toEqual(["bot-1", "bot-2"]);
		expect(readCredentials(path).activeAccount).toBe("bot-2");
	});

	test("a write that cannot serialize keeps the previous accounts", () => {
		const path = newPath();
		saveAccount(bot(), path);
		const before = readFileSync(path, "utf-8");
		// A BigInt is what the serializer refuses: the shape is never read, only written,
		// so the cast hides nothing, and nothing reaches the file.
		const unserializable = { accounts: { x: { createdAt: 1n } } } as unknown as CredentialsFile;
		expect(() => writeCredentials(path, unserializable)).toThrow();
		expect(readFileSync(path, "utf-8")).toBe(before);
		expect(readdirSync(dirname(path))).toEqual(["credentials.json"]);
	});
});
