/**
 * Reading and writing `<agent-dir>/wechat/credentials.json`.
 *
 * The file is written `0600` and holds one bot account: the account a session
 * binds to with `/wechat start`. A file an older version wrote as a map of
 * accounts is read as the one it was polling (its `activeAccount`, else its
 * first entry), and the rewrite that drops the rest is `migrateCredentials`.
 * Malformed or partial entries are dropped on read rather than trusted, so a
 * corrupt file degrades to "not logged in".
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writeJsonFile } from "../../../lib/json.ts";
import { DEFAULT_BASE_URL } from "../transport/client.ts";
import type { BotCredentials, CredentialsFile } from "../types.ts";

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

/**
 * The key an account is stored under and a session binds to.
 *
 * `ilinkBotId` is the server's own bot identity; the user id is the fallback for
 * an account a login response named without one.
 */
export function accountKey(account: BotCredentials): string {
	return account.ilinkBotId || account.ilinkUserId;
}

/** The first well-formed account in a legacy map, so a broken active pointer still degrades. */
function firstAccount(entries: Record<string, unknown>): BotCredentials | undefined {
	for (const value of Object.values(entries)) {
		const account = normalizeAccount(value);
		if (account) return account;
	}
	return undefined;
}

/** The one account a pre-single-account file was polling. */
function legacyAccount(raw: Record<string, unknown>): CredentialsFile {
	const accounts = raw.accounts;
	if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) return {};
	const entries = accounts as Record<string, unknown>;
	const active = typeof raw.activeAccount === "string" ? entries[raw.activeAccount] : undefined;
	const chosen = normalizeAccount(active) ?? firstAccount(entries);
	return chosen === undefined ? {} : { account: chosen };
}

/** Read and validate a credentials file; a missing/corrupt file yields none. */
export function readCredentials(path: string): CredentialsFile {
	try {
		if (!existsSync(path)) return {};
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const raw = parsed as Record<string, unknown>;
		const account = normalizeAccount(raw.account);
		return account ? { account } : legacyAccount(raw);
	} catch {
		return {};
	}
}

/**
 * Write a credentials file by the one atomic JSON write, mode `0600`.
 *
 * The mode is on the temp file, so the rename publishes a private file: a torn
 * write here would parse as no account at all, and the user would pay a fresh QR
 * scan to get back in.
 */
export function writeCredentials(path: string, file: CredentialsFile): void {
	writeJsonFile(path, file, { mode: 0o600 });
}

/** Store the account, replacing whatever was stored before it. */
export function saveAccount(account: BotCredentials, path = credentialsPath()): void {
	writeCredentials(path, { account });
}

/** Remove the stored account (used by `/wechat logout`). */
export function clearCredentials(path = credentialsPath()): void {
	writeCredentials(path, {});
}

/** The account the bridge should run, if one is stored. */
export function storedAccount(path = credentialsPath()): BotCredentials | undefined {
	return readCredentials(path).account;
}

/**
 * Rewrite a file an older version wrote as an account map down to the one account
 * it was polling, dropping the others.
 *
 * The read above stays pure, so this one-time write belongs to a session's start
 * rather than to every read. Returns whether it wrote.
 */
export function migrateCredentials(path = credentialsPath()): boolean {
	if (!hasAccountMap(path)) return false;
	writeCredentials(path, readCredentials(path));
	return true;
}

/** Whether the file still carries the account map an older version wrote. */
function hasAccountMap(path: string): boolean {
	try {
		if (!existsSync(path)) return false;
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
		return (parsed as Record<string, unknown>).accounts !== undefined;
	} catch {
		return false;
	}
}
