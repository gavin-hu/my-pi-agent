/**
 * The `session` tool.
 *
 * One action-shaped tool keeps the prompt surface small: status, send, inbox,
 * claim, release, join. The runtime owns file I/O and lifecycle; this
 * module only validates the action, calls the runtime, and hands the result to
 * the shared presentation module — one collapsed line, or the board's rows on
 * expand.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { errorResult, textResult } from "../../lib/tool-result.ts";
import { callLine, detailsOrLine } from "../../lib/tui/tool.ts";
import { formatClaim, formatInbox, formatJoin, formatRelease, formatSend, formatStatus } from "./format.ts";
import { normalizeAction, TOOL_NAME } from "./protocol.ts";
import type { SessionBus } from "./runtime.ts";
import { collapsedLine, resultSections, SessionResult } from "./result.ts";
import type { SessionDetails } from "./types.ts";

export { TOOL_NAME };

const SessionParams = Type.Object({
	action: StringEnum(["status", "send", "inbox", "claim", "release", "join"] as const, {
		description: "status, send, inbox, claim, release, or join.",
	}),
	to: Type.Optional(Type.String({ description: "Target session label/id, or * for an event broadcast." })),
	text: Type.Optional(Type.String({ description: "Message text, at most 4000 characters." })),
	kind: Type.Optional(
		StringEnum(["message", "event", "ask", "handoff"] as const, {
			description: "Message kind; defaults to message.",
		}),
	),
	paths: Type.Optional(
		Type.Array(Type.String(), { description: "Repository-relative file or directory paths to claim or release." }),
	),
	limit: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 50, description: "Inbox messages to consume (default 20)." }),
	),
	wake: Type.Optional(
		Type.Boolean({
			description: "With join: mail raises one turn per burst once the agent is idle; omitted waits for the next turn.",
		}),
	),
	listen: Type.Optional(
		Type.Boolean({
			description: "With join: false joins without listening, so mail waits in the inbox until `inbox` reads it.",
		}),
	),
	label: Type.Optional(
		Type.String({ description: "With join: what other sessions call this one, e.g. `billing-lead`." }),
	),
});

type SessionArgs = Static<typeof SessionParams>;

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
		description:
			"Coordinate parallel Pi sessions on this repository. Actions: `status` (sessions, unread, claims), " +
			"`send` (to a label/id, or `*` for an event), `inbox` (consume messages), `claim`/`release` (paths), " +
			"`join` (get on the bus under a label, and listen for mail unless `listen: false`; `wake` raises a turn). " +
			"Delivery is pull-based unless this session joined and is listening.",
		promptSnippet: "Coordinate parallel sessions: status, send, inbox, claim, release, join.",
		promptGuidelines: [
			"Check `session inbox` when starting a coordinated turn.",
			"Claim the paths you will edit before changing them; release them when done.",
			'Send `kind: "event"` for contract, build, or test changes another session needs.',
			"Never put credentials or secrets in a session-bus message.",
		],
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
						return textResult(formatStatus(status), { action, status });
					}
					case "send": {
						const result = await bus.send({
							to: typeof args.to === "string" ? args.to : "",
							text: typeof args.text === "string" ? args.text : "",
							kind: args.kind,
							paths: args.paths,
						});
						return textResult(formatSend(result.delivered, result.messageId), {
							action,
							delivered: result.delivered,
							messageId: result.messageId,
						});
					}
					case "inbox": {
						const messages = await bus.inbox(args.limit);
						return textResult(formatInbox(messages), { action, messages });
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
			const view =
				context?.lastComponent instanceof SessionResult ? context.lastComponent : new SessionResult(sections, theme);
			view.setInput(sections, theme);
			return view;
		},
	});
}
