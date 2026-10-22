/**
 * The `session` tool.
 *
 * One action-shaped tool keeps the prompt surface small: status, send, inbox,
 * claim, release. The runtime owns file I/O and lifecycle; this module only
 * validates the action, calls the runtime, and renders a compact result.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { errorResult, textResult } from "../../lib/tool-result.ts";
import { callLine, detailsOrLine } from "../../lib/tui/tool.ts";
import { formatClaim, formatInbox, formatRelease, formatSend, formatStatus } from "./format.ts";
import { normalizeAction, TOOL_NAME } from "./protocol.ts";

export { TOOL_NAME };
import type { SessionBus } from "./runtime.ts";
import type { SessionDetails } from "./types.ts";

const SessionParams = Type.Object({
	action: StringEnum(["status", "send", "inbox", "claim", "release"] as const, {
		description: "status, send, inbox, claim, or release.",
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
});

type SessionArgs = Static<typeof SessionParams>;

export function registerTools(pi: ExtensionAPI, bus: SessionBus): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Session bus",
		description:
			"Coordinate parallel Pi sessions on this repository. Actions: `status` (sessions, unread, claims), " +
			"`send` (to a label/id, or `*` for an event), `inbox` (consume messages), `claim`/`release` (paths). " +
			"The inbox is pull-based; it never wakes a session or injects a turn.",
		promptSnippet: "Coordinate parallel sessions: status, send, inbox, claim, release.",
		promptGuidelines: [
			"Check `session inbox` when starting or joining a coordinated turn.",
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
				}
			} catch (error) {
				return errorResult(action, error instanceof Error ? error.message : String(error));
			}
		},

		renderCall(args, theme, context) {
			const action = typeof args.action === "string" ? args.action : "session";
			const to = typeof args.to === "string" ? ` ${args.to}` : "";
			return callLine(theme, context.lastComponent, TOOL_NAME, `${action}${to}`, "middle");
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
			if (value.error) {
				text.setText(paint(theme, "bad", `Session bus: ${value.error}`));
			} else if (value.action === "status" && value.status) {
				text.setText(
					paint(theme, "meta", `${value.status.sessions.length} session(s) · ${value.status.claims.length} claim(s)`),
				);
			} else if (value.action === "send") {
				text.setText(paint(theme, "ok", `Delivered to ${value.delivered?.join(", ") ?? "nobody"}`));
			} else if (value.action === "inbox") {
				text.setText(paint(theme, "meta", `${value.messages?.length ?? 0} message(s)`));
			} else if (value.action === "claim") {
				const conflicts = value.conflicts?.length ?? 0;
				text.setText(
					conflicts > 0
						? paint(theme, "warn", `${conflicts} claim conflict(s)`)
						: paint(theme, "ok", `Claimed ${value.claimed?.join(", ") ?? "nothing"}`),
				);
			} else {
				text.setText(paint(theme, "meta", `Released ${value.released?.join(", ") ?? "nothing"}`));
			}
			return text;
		},
	});
}
