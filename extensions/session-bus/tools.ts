/**
 * The `session` tool.
 *
 * One action-shaped tool keeps the prompt surface small: status, send, read, inbox,
 * claim, release, join. The runtime owns file I/O and lifecycle; this
 * module only validates the action, calls the runtime, and hands the result to
 * the shared presentation module — one collapsed line, or the board's rows on
 * expand.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { notDeliveredLine } from "../../lib/session-tool.ts";
import { StringEnum } from "../../lib/tool-schema.ts";
import { errorResult, textResult } from "../../lib/tool-result.ts";
import { callLine, detailsOrLine, isTailResult, TailResult } from "../../lib/tui/tool.ts";
import { formatClaim, formatInbox, formatJoin, formatRead, formatRelease, formatSend, formatStatus } from "./format.ts";
import { normalizeAction, normalizeLimit, sendOutcome, TOOL_NAME } from "./protocol.ts";
import type { SessionBus } from "./runtime.ts";
import { collapsedLine, resultSections } from "./result.ts";
import type { BusRow } from "./rows.ts";
import type { SessionDetails } from "./types.ts";

export { TOOL_NAME };

export const SessionParams = Type.Object({
	action: StringEnum(["status", "send", "inbox", "read", "claim", "release", "join"] as const, {
		description: "`status` reads without joining; every other action puts this session on the bus.",
	}),
	to: Type.Optional(
		Type.String({ description: "Target label/id, or `*` for every other live session — needs `kind: \"event\"`." }),
	),
	text: Type.Optional(Type.String({ description: "Message text, at most 4000 characters." })),
	kind: Type.Optional(
		StringEnum(["message", "event", "ask", "handoff"] as const, {
			description: "Message kind; defaults to message.",
		}),
	),
	key: Type.Optional(
		Type.String({
			description:
				"With send: a resend repeating this key, kind, text and paths folds into the copy still waiting; letters, digits, `.`, `_`, `-`, `:`, at most 64.",
		}),
	),
	paths: Type.Optional(
		Type.Array(Type.String(), {
			description: "Repository-relative file or directory paths to claim or release; at most 20.",
		}),
	),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Messages one read shows or consumes; default 20." })),
	wake: Type.Optional(
		Type.Boolean({
			description: "With join: mail raises one turn per burst once idle; omitted waits for the next turn.",
		}),
	),
	listen: Type.Optional(
		Type.Boolean({ description: "With join: false joins without listening, so mail waits for `inbox`." }),
	),
	label: Type.Optional(Type.String({ description: "With join: the name peers address, e.g. `billing-lead`." })),
});

type SessionArgs = Static<typeof SessionParams>;

/** What the tool is and what it guarantees: the verbs and their objects, and the delivery rule. */
export const SESSION_DESCRIPTION =
	"Coordinate parallel Pi sessions on this repository. Actions: `status` (sessions, unread, claims), " +
	"`send` (a label/id, or `*`), `inbox` (consume), `read` (show, keep), " +
	"`claim`/`release` (paths), " +
	"`join` (a label, listening unless `listen: false`; `wake` raises a turn). " +
	"Delivery is pull-based unless this session joined and is listening.";

/** The one line in the system prompt's tools list, not a copy of the description. */
export const SESSION_SNIPPET = "Coordinate parallel sessions: status, send, read, inbox, claim, release, join.";

/** When, in what order, and what never to put on the wire. */
export const SESSION_GUIDELINES = [
	"Mail waits in an inbox until its session runs, so give a peer `join` with `wake` and end the turn — a `sleep` holds the very turn that would report it.",
	"Claim the paths you will edit before changing them; release them when done.",
	'Send `kind: "event"` for contract, build, or test changes another session needs.',
	"Never put credentials or secrets in a session-bus message.",
];

/**
 * The call line's subject: the verb, and what it acts on. `end` clipping keeps
 * the verb readable, because the paths that follow are the detail, not the
 * identity of the call.
 */
function callSubject(action: string, args: Record<string, unknown>): string {
	if (action === "join") {
		const label = typeof args.label === "string" ? args.label.trim() : "";
		return label ? `join ${label}` : "join";
	}
	if (action === "send") {
		const to = typeof args.to === "string" ? args.to : "";
		return to ? `send ${to}` : "send";
	}
	if (action !== "claim" && action !== "release") return action;
	const paths = Array.isArray(args.paths) ? args.paths.filter((path): path is string => typeof path === "string") : [];
	const [first, ...rest] = paths;
	if (first === undefined) return action;
	return `${action} ${first}${rest.length > 0 ? ` +${rest.length}` : ""}`;
}

export function registerTools(pi: ExtensionAPI, bus: SessionBus): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Session bus",
		description: SESSION_DESCRIPTION,
		promptSnippet: SESSION_SNIPPET,
		promptGuidelines: SESSION_GUIDELINES,
		parameters: SessionParams,
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as SessionArgs;
			const action = normalizeAction(args.action);
			if (!action) return errorResult("status", `unknown action "${String(args.action)}".`);
			try {
				await bus.start(ctx);
				switch (action) {
					case "status": {
						const status = await bus.status();
						// The clock the unaccounted ages are read with: passed rather than reached for inside.
						return textResult(formatStatus(status, Date.now()), { action, status });
					}
					case "send": {
						const result = await bus.send({
							to: typeof args.to === "string" ? args.to : "",
							text: typeof args.text === "string" ? args.text : "",
							kind: args.kind,
							key: args.key,
							paths: args.paths,
						});
						// What the send is worth is the protocol's answer, so a command's request reports it in
						// the same words; the line either way is one helper's, so it cannot differ from `team`'s.
						const outcome = sendOutcome(result);
						if (!outcome.ok) return errorResult(action, outcome.error);
						const line = notDeliveredLine(result.failed);
						return textResult([formatSend(result.delivered, result.messageId), line].filter(Boolean).join("\n"), {
							action,
							delivered: result.delivered,
							...(result.failed.length === 0 ? {} : { failed: result.failed }),
							messageId: result.messageId,
						});
					}
					case "inbox": {
						// A read consumes what it showed, so a body the text does not carry would be mail no
						// later call could return. The peek leaves the front where it is, so the messages it
						// shows are the ones it then consumes — and its `unread` names every file in the inbox,
						// which is the count the tail is taken from rather than the window, because `peek`
						// stops at `MAX_LIMIT` and a tail taken from its page would saturate past that.
						const pending = await bus.peek();
						const window = pending.mail.slice(0, normalizeLimit(args.limit));
						// Mail this build cannot read is left on disk for a build that can, so it is
						// named rather than counted into the tail — a tail that promised it would
						// otherwise answer `Inbox empty.` on the next call.
						const read = formatInbox(window, Math.max(0, pending.unread.size - window.length), pending.unreadable);
						const messages = read.shown === 0 ? [] : await bus.inbox(read.shown);
						return textResult(read.text, {
							action,
							messages,
							...(pending.unreadable.length === 0 ? {} : { unreadable: pending.unreadable }),
						});
					}
					case "read": {
						// Marks what it shows as told, so the count falls and no notice repeats it — and keeps
						// every file, so this is the call for a burst the notice only previewed.
						const page = await bus.read(normalizeLimit(args.limit));
						const text = formatRead(page.mail, Math.max(0, page.unread.size - page.mail.length), page.unreadable);
						return textResult(text, {
							action,
							messages: page.mail,
							...(page.unreadable.length === 0 ? {} : { unreadable: page.unreadable }),
						});
					}
					case "claim": {
						const result = await bus.claim(args.paths);
						return textResult(formatClaim(result.claimed, result.conflicts), {
							action,
							claimed: result.claimed,
							conflicts: result.conflicts,
						});
					}
					case "release": {
						const result = await bus.release(args.paths);
						return textResult(formatRelease(result.released, result.notOwned), {
							action,
							released: result.released,
							notOwned: result.notOwned,
						});
					}
					case "join": {
						const label = typeof args.label === "string" ? args.label.trim() : "";
						const joined = await bus.join({
							...(label === "" ? {} : { label }),
							...(args.wake === undefined ? {} : { wake: args.wake }),
							...(args.listen === undefined ? {} : { listen: args.listen }),
						});
						// A label is the bus's name and Pi's session name in one act, so the footer,
						// `/resume`, and the record a peer addresses agree. A bare join derives its
						// label from the name Pi already shows and must not rename it back.
						if (label !== "") pi.setSessionName(joined.label);
						return textResult(formatJoin(joined.label, joined.watching), {
							action,
							label: joined.label,
							watching: joined.watching,
						});
					}
				}
			} catch (error) {
				return errorResult(action, error instanceof Error ? error.message : String(error));
			}
		},

		renderCall(args, theme, context) {
			const action = typeof args.action === "string" ? args.action : "session";
			return callLine(theme, context.lastComponent, TOOL_NAME, callSubject(action, args as Record<string, unknown>));
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<SessionDetails>(result.details);
			const outcome = detailsOrLine(theme, result, options.expanded, details);
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			const value = outcome.details;
			const sections = options.expanded ? resultSections(value) : undefined;
			if (!sections) {
				text.setText(collapsedLine(theme, value));
				return text;
			}
			const previous = context?.lastComponent;
			const view = isTailResult<BusRow>(previous) ? previous : new TailResult<BusRow>(sections, theme);
			view.setInput(sections, theme);
			return view;
		},
	});
}
