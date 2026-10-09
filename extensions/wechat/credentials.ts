/**
 * Reading and writing `<agentDir>/wechat/credentials.json`.
 *
 * The file is written `0600` and holds one entry per bot account, keyed by
 * `ilinkBotId`. Malformed or partial entries are dropped on read rather than
 * trusted, so a corrupt file degrades to "not logged in".
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_BASE_URL } from "./client.ts";
import type { BotCredentials, CredentialsFile } from "./types.ts";

/** The bridge's directory under the agent dir. */
export function wechatDir(): string {
	return join(getAgentDir(), "wechat");
}

/** The default credentials file path. */
export function credentialsPath(): string {
	return join(wechatDir(), "credentials.json");
}

function normalizeAccount(value: unknown): BotCredentials | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const botToken = typeof raw.botToken === "string" ? raw.botToken.trim() : "";
	const ilinkUserId = typeof raw.ilinkUserId === "string" ? raw.ilinkUserId.trim() : "";
	if (!botToken || !ilinkUserId) return undefined;
	return {
		botToken,
		ilinkUserId,
		ilinkBotId: typeof raw.ilinkBotId === "string" ? raw.ilinkBotId.trim() : "",
		baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.trim() ? raw.baseUrl.trim() : DEFAULT_BASE_URL,
		botAgent: typeof raw.botAgent === "string" && raw.botAgent.trim() ? raw.botAgent.trim() : "pi-wechat",
		createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
	};
}

/** Read and validate a credentials file; a missing/corrupt file yields none. */
export function readCredentials(path: string): CredentialsFile {
	try {
		if (!existsSync(path)) return { accounts: {} };
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { accounts: {} };
		const rawAccounts = (parsed as Record<string, unknown>).accounts;
		if (!rawAccounts || typeof rawAccounts !== "object" || Array.isArray(rawAccounts)) return { accounts: {} };
		const accounts: Record<string, BotCredentials> = {};
		for (const [id, value] of Object.entries(rawAccounts as Record<string, unknown>)) {
			const account = normalizeAccount(value);
			if (account) accounts[id] = account;
		}
		return { accounts };
	} catch {
		return { accounts: {} };
	}
}

/** Write a credentials file atomically enough for a config file, mode `0600`. */
export function writeCredentials(path: string, file: CredentialsFile): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		// Best effort: the mode argument already applied on POSIX.
	}
}

/** Store or replace one account. */
export function saveAccount(account: BotCredentials, path = credentialsPath()): void {
	const file = readCredentials(path);
	const key = account.ilinkBotId || account.ilinkUserId;
	file.accounts[key] = account;
	writeCredentials(path, file);
}

/** Remove every stored account (used by `/wechat logout`). */
export function clearCredentials(path = credentialsPath()): void {
	writeCredentials(path, { accounts: {} });
}

/** The first stored account, if any. */
export function primaryAccount(path = credentialsPath()): BotCredentials | undefined {
	const file = readCredentials(path);
	const [first] = Object.values(file.accounts);
	return first;
}
