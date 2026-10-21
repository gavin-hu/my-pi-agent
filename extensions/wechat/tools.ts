/**
 * Model-facing registration for the `send_wechat` tool.
 *
 * The bridge replies to inbound messages automatically; this tool is for the
 * agent to message the owner proactively. It is deliberately owner-only and
 * text-only: the model cannot choose a recipient, so untrusted generated text
 * cannot be aimed at an arbitrary WeChat account.
 */

import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { callLine, errorLine, rejectionLine } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import type { Bridge } from "./bridge.ts";

export const TOOL_NAME = "send_wechat";

const WechatSendParams = Type.Object({
	text: Type.String({
		minLength: 1,
		maxLength: 4000,
		description: "The message to send to the WeChat owner. Plain text.",
	}),
});
type WechatSendArgs = Static<typeof WechatSendParams>;

const WechatSendResult = Type.Object({
	sent: Type.Boolean({ description: "Whether the message was delivered to the WeChat backend." }),
	error: Type.Optional(Type.String({ description: "Why the send failed, when sent is false." })),
});

export interface ToolDeps {
	getBridge: () => Bridge | undefined;
}

function sendResult(sent: boolean, error?: string) {
	const details = error === undefined ? { sent } : { sent, error };
	const structuredContent: Record<string, JsonValue> = { sent };
	if (error !== undefined) structuredContent.error = error;
	return {
		content: [
			{
				type: "text" as const,
				text: sent ? "Sent to the WeChat owner." : `WeChat send failed: ${error ?? "unknown error"}`,
			},
		],
		details,
		structuredContent,
		...(sent ? {} : { isError: true as const }),
	};
}

export function registerTools(pi: ExtensionAPI, deps: ToolDeps): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "WeChat send",
		description: [
			"Send a plain-text WeChat message to the account owner from the running bridge (start it with /wechat login).",
			"The recipient is always the owner and cannot be chosen.",
		].join(" "),
		promptSnippet: "Send a plain-text WeChat message to the account owner.",
		promptGuidelines: [
			"Use send_wechat only to message the owner proactively, not to answer an inbound WeChat message (the bridge replies automatically).",
			"Keep messages concise and do not include secrets unless the user asked for them.",
		],
		parameters: WechatSendParams,
		outputSchema: WechatSendResult,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
		executionMode: "sequential",

		async execute(_toolCallId, params) {
			const args = params as WechatSendArgs;
			const bridge = deps.getBridge();
			if (!bridge) {
				return sendResult(false, "WeChat bridge is not started. Run /wechat login first.");
			}
			const outcome = await bridge.sendToOwner(args.text);
			return sendResult(outcome.ok, outcome.error);
		},

		renderCall(args, theme, context) {
			const body = (args as { text?: unknown }).text;
			const label = context.argsComplete && typeof body === "string" ? body : "…";
			return callLine(theme, context.lastComponent, TOOL_NAME, label);
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context.lastComponent);
			const details = toolDetails<{ sent?: boolean; error?: string }>(result.details);
			if (details?.sent) {
				text.setText(paint(theme, "ok", "sent to WeChat owner"));
				return text;
			}
			if (details?.error) {
				text.setText(errorLine(theme, details.error));
				return text;
			}
			// Pi's rejection result carries `{}`; show its sanitized message.
			text.setText(rejectionLine(theme, result, options.expanded));
			return text;
		},
	});
}
