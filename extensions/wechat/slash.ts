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
}

/** One built-in command. */
export interface SlashCommand {
	/** Name without the leading slash; matched case-insensitively. */
	name: string;
	/** One-line description. */
	summary: string;
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
 * The built-in commands. `/new` and `/help`.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
	{
		name: "new",
		summary: "Start a new session",
		kind: "action",
		ownerOnly: true,
		run: async (ctx) => {
			await ctx.reply("Starting a new session. WeChat will reconnect in a moment.");
			ctx.session.newSession();
		},
	},
	{
		name: "help",
		summary: "List the chat commands",
		kind: "action",
		run: async (ctx) => {
			await ctx.reply(helpText(SLASH_COMMANDS));
		},
	},
];

/**
 * The reply `/help` sends: one line per command, an owner-only marker, and a
 * note that ordinary text reaches the agent.
 */
export function helpText(commands: readonly SlashCommand[]): string {
	const lines = commands.map((command) => {
		const scope = command.ownerOnly ? " (owner only)" : "";
		return `/${command.name} — ${command.summary}${scope}`;
	});
	return ["Available commands:", ...lines, "Anything else you type reaches the agent."].join("\n");
}
