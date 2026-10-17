/**
 * Inbound slash commands: a small built-in registry of commands a WeChat peer
 * can type in the chat.
 *
 * A command is either a `snippet` (a predefined body expanded into the user
 * turn) or an `action` (run locally and answered on WeChat, with no agent turn).
 * Parsing and lookup are pure, so the bridge can intercept inbound text without
 * I/O; the bridge builds the {@link SlashContext} that actions run against.
 *
 * Value-only: no module-level state.
 */

import { notice, type PeerLanguage } from "./format.ts";

/** The two command kinds. */
export type SlashKind = "snippet" | "action";

/** The session controls an action may invoke. */
export interface SlashSessionControls {
	/** Start a fresh Pi session; wired to the `/wechat new` dispatch. */
	newSession: () => void;
}

/** The environment an action handler runs in. */
export interface SlashContext {
	/** Text after the command name, trimmed. */
	args: string;
	/** The peer that typed the command. */
	peer: string;
	/** Send one message back to that peer (chunked by the bridge). */
	reply: (text: string) => Promise<void>;
	/** Session controls for the action. */
	session: SlashSessionControls;
	/** Whether a turn is in flight right now, so an action must not restart. */
	activeTurn: boolean;
	/** The language the peer writes in, for the reply text. */
	language: PeerLanguage;
}

/** One built-in command. */
export interface SlashCommand {
	/** Name without the leading slash; matched case-insensitively. */
	name: string;
	/** One-line description. */
	summary: string;
	/** Chinese one-line description; falls back to {@link summary}. */
	summaryZh?: string;
	kind: SlashKind;
	/** `snippet` body, expanded into the turn. */
	snippet?: string;
	/** `action` handler, run instead of starting a turn. */
	run?: (ctx: SlashContext) => void | Promise<void>;
	/** When true, only the owner may run it. Default false. */
	ownerOnly?: boolean;
}

/** A parsed slash command: the lowercased name and the rest of the text. */
export interface ParsedSlash {
	name: string;
	args: string;
}

const SLASH_PATTERN = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/;

/** Parse `text` as a slash command, or return undefined when it is not one. */
export function parseSlash(text: string): ParsedSlash | undefined {
	const match = SLASH_PATTERN.exec(text.trimStart());
	if (!match) return undefined;
	return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

/** The command named `name`, ignoring case. */
export function findSlashCommand(commands: readonly SlashCommand[], name: string): SlashCommand | undefined {
	const lower = name.toLowerCase();
	return commands.find((command) => command.name.toLowerCase() === lower);
}

/**
 * The turn text a snippet expands to: its body, with any trailing args appended
 * as a separate paragraph. Just the body when there are no args.
 */
export function expandSnippet(command: SlashCommand, args: string): string {
	const body = command.snippet ?? "";
	if (!args) return body;
	return body ? `${body}\n\n${args}` : args;
}

/**
 * Pick the string for a peer's language, Chinese first when it writes Chinese.
 */
function localized(lang: PeerLanguage, zh: string, en: string): string {
	return lang === "zh" ? zh : en;
}

/**
 * The built-in commands. `/new` and `/help`.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
	{
		name: "new",
		summary: "Start a new session",
		summaryZh: "开始新会话",
		kind: "action",
		ownerOnly: true,
		run: async (ctx) => {
			// A turn owns the session: restarting now would kill the run answering
			// this very peer, so decline and let them ask again afterwards.
			if (ctx.activeTurn) {
				await ctx.reply(notice("newBusy", ctx.language));
				return;
			}
			await ctx.reply(
				localized(
					ctx.language,
					"正在开始新会话，微信稍后会自动重连。",
					"Starting a new session. WeChat will reconnect in a moment.",
				),
			);
			ctx.session.newSession();
		},
	},
	{
		name: "help",
		summary: "List the chat commands",
		summaryZh: "列出聊天命令",
		kind: "action",
		run: async (ctx) => {
			await ctx.reply(helpText(SLASH_COMMANDS, ctx.language));
		},
	},
];

/**
 * The reply `/help` sends: one line per command, an owner-only marker, and a
 * note that ordinary text reaches the agent.
 */
export function helpText(commands: readonly SlashCommand[], lang: PeerLanguage = "en"): string {
	const only = localized(lang, "（仅限所有者）", " (owner only)");
	const lines = commands.map((command) => {
		const scope = command.ownerOnly ? only : "";
		const summary = (lang === "zh" ? command.summaryZh : undefined) ?? command.summary;
		return `/${command.name} — ${summary}${scope}`;
	});
	const header = localized(lang, "可用命令：", "Available commands:");
	const footer = localized(lang, "其他内容都会发送给助手。", "Anything else you type reaches the agent.");
	return [header, ...lines, footer].join("\n");
}
