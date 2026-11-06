/**
 * Inbound slash commands: a small built-in registry of commands a WeChat peer
 * can type in the chat.
 *
 * A command runs locally and is answered on WeChat, with no agent turn, so
 * parsing and lookup stay pure and the bridge can intercept inbound text without
 * I/O; the bridge builds the {@link SlashContext} a command runs against.
 *
 * Value-only: no module-level state.
 */

import { type PeerLanguage } from "../text/format.ts";

/** What the sender's own conversation is doing, for `/status`. */
export interface SlashPeerState {
	status: "idle" | "queued" | "running";
	queued: number;
	runningMs?: number;
	/** The title of a dialog waiting on the sender, when one is. */
	prompt?: string;
	/**
	 * Whether plan mode is on for this session, when the caller reads the flag. The
	 * mode is the session's, not the conversation's, and there is one conversation.
	 */
	planMode?: boolean;
}

/** What a stop found: whether a turn was running, and how many queued messages went with it. */
export interface StopOutcome {
	stopped: boolean;
	dropped: number;
}

/** The session controls an action may invoke; every one acts on the sender. */
export interface SlashSessionControls {
	/**
	 * Stop the sender's running turn and drop the queue behind it; nothing running and
	 * nothing queued reads as a false `stopped` and a zero `dropped`.
	 */
	stop: () => StopOutcome;
	/**
	 * Withdraw the dialog waiting on the sender; false when none was waiting. Optional
	 * because a context that binds no channel has nothing to withdraw, as `history` is
	 * for a context that reads no entries.
	 */
	cancel?: () => boolean;
	/** What the sender's conversation is doing. */
	status: () => SlashPeerState;
	/** The last `count` messages of the sender's own conversation. */
	history?: (count: number) => Promise<string>;
}

/** What a builder needs to bind the session controls to one sender. */
export interface SlashControlsDeps {
	/** What that peer's conversation is doing. */
	state: (peer: string) => SlashPeerState;
	/** The title of a dialog waiting on that peer, if one waits. */
	prompt: (peer: string) => string | undefined;
	/** Stop the peer's running turn and the queue behind it. */
	stop: (peer: string) => StopOutcome;
	/** Withdraw the dialog waiting on the peer; false when none was waiting. */
	cancel: (peer: string) => boolean;
	/** The last `count` messages of the peer's own conversation. */
	history: (peer: string, count: number) => Promise<string>;
	/** Whether plan mode is on, from the session branch's flag. */
	planMode: () => boolean;
}

/**
 * The controls one action runs against, for the peer that typed the command.
 *
 * The registry owns what a command may do; the bridge owns the queue and the
 * channel, so it supplies them here and keeps no session shape of its
 * own.
 */
export function slashControls(peer: string, deps: SlashControlsDeps): SlashSessionControls {
	return {
		stop: () => deps.stop(peer),
		cancel: () => deps.cancel(peer),
		status: () => {
			const waiting = deps.prompt(peer);
			const state = { ...deps.state(peer), planMode: deps.planMode() };
			return waiting === undefined ? state : { ...state, prompt: waiting };
		},
		history: (count) => deps.history(peer, count),
	};
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
	/**
	 * Whole-line spellings beside {@link name}, without the slash: the chat accepts the
	 * terminal's `/wechat cancel`, because that is what a session with no screen is
	 * told to type, and it is not an answer to the dialog it was typed to dismiss.
	 */
	aliases?: readonly string[];
	/** One-line description. */
	summary: string;
	/** Chinese one-line description; falls back to {@link summary}. */
	summaryZh?: string;
	/**
	 * How `/help` spells the command when it takes arguments, without the slash, for
	 * example `history [n]`; defaults to {@link name}.
	 */
	usage?: string;
	/** Run instead of starting a turn. */
	run: (ctx: SlashContext) => void | Promise<void>;
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

/** A typed line resolved to the command it names, and the words it carried. */
export interface ResolvedSlash {
	command: SlashCommand;
	args: string;
}

/**
 * The command an inbound line names, and its arguments.
 *
 * A command answers to its own name and to any longer spelling it declares, matched
 * as the line's first words so that trailing text stays the command's argument. The
 * chat parses its own commands, so a form another surface documents reaches the same
 * command here instead of being read as an answer to a waiting prompt.
 */
export function resolveSlash(commands: readonly SlashCommand[], text: string): ResolvedSlash | undefined {
	const parsed = parseSlash(text);
	if (!parsed) return undefined;
	const named = findSlashCommand(commands, parsed.name);
	if (named) return { command: named, args: parsed.args };
	const typed = parsed.args === "" ? parsed.name : `${parsed.name} ${parsed.args}`;
	const lower = typed.toLowerCase();
	for (const command of commands) {
		for (const alias of command.aliases ?? []) {
			const spelling = alias.toLowerCase();
			if (lower === spelling) return { command, args: "" };
			if (lower.startsWith(`${spelling} `)) return { command, args: typed.slice(spelling.length + 1) };
		}
	}
	return undefined;
}

/**
 * Pick the string for a peer's language, Chinese first when it writes Chinese.
 */
function localized(lang: PeerLanguage, zh: string, en: string): string {
	return lang === "zh" ? zh : en;
}

/**
 * `text` with `clause` after it as its own sentence, or `text` alone when there is none:
 * a Chinese full stop separates the two already, an English one needs a space.
 */
function withClause(text: string, clause: string, lang: PeerLanguage): string {
	if (!clause) return text;
	return lang === "zh" ? `${text}${clause}` : `${text} ${clause}`;
}

/**
 * The built-in commands: `/stop`, `/cancel`, `/status`, `/history`, and `/help`.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
	{
		name: "stop",
		summary: "Stop the running answer and drop the queued messages",
		summaryZh: "停止当前回答并丢弃排队的消息",
		run: async (ctx) => {
			const { stopped, dropped } = ctx.session.stop();
			// When a turn was stopped its own `已停止。` follows; the command speaks only
			// for what that line cannot say, which is the burst it took with it.
			if (dropped > 0) {
				await ctx.reply(
					localized(ctx.language, `已丢弃排队的 ${dropped} 条消息。`, `Dropped ${dropped} queued message(s).`),
				);
				return;
			}
			if (stopped) return;
			await ctx.reply(localized(ctx.language, "现在没有在处理的回答。", "Nothing is running right now."));
		},
	},
	{
		name: "cancel",
		summary: "Withdraw the question waiting for your reply",
		summaryZh: "撤回正在等你的问题",
		aliases: ["wechat cancel"],
		run: async (ctx) => {
			// A withdrawal says so itself (`That question was withdrawn.`), so a cancel that
			// found a question adds no second bubble — the rule /stop follows for `Stopped.`
			if (ctx.session.cancel?.() === true) return;
			await ctx.reply(localized(ctx.language, "现在没有等你回答的问题。", "No question is waiting for your reply."));
		},
	},
	{
		name: "status",
		summary: "Show what this conversation is doing",
		summaryZh: "查看当前处理状态",
		run: async (ctx) => {
			const state = ctx.session.status();
			// Plan mode is otherwise the terminal's chip, which the chat cannot read, and it
			// decides whether the peer's next instruction can be acted on at all: named while
			// it is on, so the absence of the clause is the mode being off.
			const plan =
				state.planMode === true
					? localized(ctx.language, "计划模式已开启，暂时不能写入。", "Plan mode is on — writes are disabled.")
					: "";
			// A waiting dialog is the whole status while it waits: the turn is blocked on
			// it, so "working, 12s" would hide the one thing the peer can act on.
			if (state.prompt !== undefined) {
				await ctx.reply(
					localized(
						ctx.language,
						`正在等你回答「${state.prompt}」，回复「取消」可跳过。`,
						`Waiting for your answer: “${state.prompt}” — reply “cancel” to skip.`,
					),
				);
				return;
			}
			if (state.status !== "running") {
				await ctx.reply(
					withClause(
						state.queued > 0
							? localized(
									ctx.language,
									`排队中，还有 ${state.queued} 条。`,
									`Queued — ${state.queued} message(s) waiting.`,
								)
							: localized(ctx.language, "空闲。", "Idle."),
						plan,
						ctx.language,
					),
				);
				return;
			}
			const seconds = Math.max(0, Math.round((state.runningMs ?? 0) / 1000));
			const queued =
				state.queued > 0 ? localized(ctx.language, `，后面还有 ${state.queued} 条`, `, ${state.queued} queued`) : "";
			await ctx.reply(
				withClause(
					localized(ctx.language, `正在处理，已用 ${seconds} 秒${queued}。`, `Working — ${seconds}s so far${queued}.`),
					plan,
					ctx.language,
				),
			);
		},
	},
	{
		name: "history",
		usage: "history [n]",
		summary: "Show recent messages (default 8, max 20)",
		summaryZh: "查看最近几条对话（默认 8 条，最多 20 条）",
		run: async (ctx) => {
			const requested = Number.parseInt(ctx.args, 10);
			const count = Math.min(20, Math.max(1, Number.isFinite(requested) ? requested : 8));
			const text = (await ctx.session.history?.(count)) ?? "";
			await ctx.reply(text || (ctx.language === "zh" ? "还没有历史消息。" : "No history yet in this conversation."));
		},
	},
	{
		name: "help",
		summary: "List the chat commands",
		summaryZh: "列出聊天命令",
		run: async (ctx) => {
			await ctx.reply(helpText(SLASH_COMMANDS, ctx.language));
		},
	},
];

/** The fields `/help` reads, so a caller need not build a whole command. */
export type HelpEntry = Pick<SlashCommand, "name" | "summary" | "summaryZh" | "usage">;

/**
 * The reply `/help` sends: one line per command, its arguments with it so an
 * option is discoverable from the chat, and a note that ordinary text reaches the
 * agent.
 */
export function helpText(commands: readonly HelpEntry[], lang: PeerLanguage = "en"): string {
	const lines = commands.map((command) => {
		const summary = (lang === "zh" ? command.summaryZh : undefined) ?? command.summary;
		return `/${command.usage ?? command.name} — ${summary}`;
	});
	const header = localized(lang, "可用命令：", "Available commands:");
	const footer = localized(lang, "其他内容都会发送给助手。", "Anything else you type reaches the agent.");
	return [header, ...lines, footer].join("\n");
}
