/**
 * The `session` tool.
 *
 * One action-shaped tool keeps the prompt surface small: status, send, inbox,
 * claim, release, join, leave, watch, name. The runtime owns file I/O and
 * lifecycle; this module only validates the action, calls the runtime, and hands
 * the result to the shared presentation module — one collapsed line, or the
 * board's rows on expand.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { errorResult, textResult } from "../../lib/tool-result.ts";
import { callLine, detailsOrLine } from "../../lib/tui/tool.ts";
import {
	formatClaim,
	formatInbox,
	formatJoin,
	formatName,
	formatRelease,
	formatSend,
	formatStatus,
	formatWatch,
} from "./format.ts";
import { normalizeAction, TOOL_NAME } from "./protocol.ts";
import type { SessionBus } from "./runtime.ts";
import { collapsedLine, resultSections, SessionResult } from "./result.ts";
import type { SessionDetails } from "./types.ts";

export { TOOL_NAME };

const SessionParams = Type.Object({
	action: StringEnum(["status", "send", "inbox", "claim", "release", "join", "leave", "watch", "name"] as const, {
		description: "status, send, inbox, claim, release, join, leave, watch, or name.",
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
			description:
				"With watch: set the mode — true raises one turn per burst, false waits for the next turn, omitted keeps it.",
		}),
	),
	stop: Type.Optional(Type.Boolean({ description: "With watch: turn this session's inbox watch off." })),
	team: Type.Optional(
		Type.String({
			description: "With join/leave: the split's name — the plan file name without `.md`.",
		}),
	),
	unit: Type.Optional(Type.String({ description: "With join/leave: the unit to claim or release, e.g. `core`." })),
	label: Type.Optional(
		Type.String({ description: "With name: what other sessions call this one, e.g. `billing-lead`." }),
	),
});

type SessionArgs = Static<typeof SessionParams>;

/**
 * The call line's subject: the verb, and what it acts on. `end` clipping keeps
 * the verb readable, because the paths that follow are the detail, not the
 * identity of the call.
 */
function callSubject(action: string, args: Record<string, unknown>): string {
	if (action === "name") {
		const label = typeof args.label === "string" ? args.label.trim() : "";
		return label ? `name ${label}` : "name";
	}
	if (action === "send") {
		const to = typeof args.to === "string" ? args.to : "";
		return to ? `send ${to}` : "send";
	}
	if (action === "join" || action === "leave") {
		const unit = typeof args.unit === "string" ? args.unit : "";
		const team = typeof args.team === "string" ? args.team : "";
		return [action, unit, team && !unit ? team : ""].filter(Boolean).join(" ");
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
			"Coordinate parallel Pi sessions on this repository. Actions: `status` (sessions, unread, claims, joined units), " +
			"`send` (to a label/id, or `*` for an event), `inbox` (consume messages), `claim`/`release` (paths), " +
			"`join`/`leave` (a unit of an approved split, by `team` and `unit`), " +
			"`watch` (report new mail at your next turn, or raise one with `wake`; `stop` turns it off). " +
			"Delivery is pull-based unless this session arms `watch`.",
		promptSnippet: "Coordinate parallel sessions: status, send, inbox, claim, release, join, leave, watch, name.",
		promptGuidelines: [
			"Check `session inbox` when starting or joining a coordinated turn.",
			"Claim the paths you will edit before changing them; release them when done.",
			"When a plan was approved with a split, `join` its unit once at the start of the work and `leave` it when merged.",
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
						const result = await bus.join({ team: args.team, unit: args.unit });
						return textResult(formatJoin(result.team, result.unit, result.claimed, result.conflicts), {
							action,
							team: result.team,
							unit: result.unit,
							claimed: result.claimed,
							conflicts: result.conflicts,
						});
					}
					case "leave": {
						const result = await bus.leave({ team: args.team, unit: args.unit });
						return textResult(formatRelease(result.released, result.notOwned), {
							action,
							released: result.released,
							notOwned: result.notOwned,
							...(args.team === undefined ? {} : { team: args.team }),
							...(args.unit === undefined ? {} : { unit: args.unit }),
						});
					}
					case "watch": {
						const watching = await bus.watch({ wake: args.wake, stop: args.stop });
						return textResult(formatWatch(watching), { action, watching });
					}
					case "name": {
						const label = typeof args.label === "string" ? args.label.trim() : "";
						if (!label) return errorResult(action, 'name requires a label, e.g. "billing-lead".');
						const named = await bus.rename(label);
						// The bus's label and Pi's session name are one identity: the footer,
						// `/resume`, and the record a peer addresses have to agree.
						pi.setSessionName(named);
						return textResult(formatName(named), { action, label: named });
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
