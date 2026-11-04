/**
 * Model-facing registration for the `send_wechat` tool.
 *
 * The bridge replies to inbound messages automatically; this tool is for the
 * agent to message the owner proactively. It is deliberately owner-only: the
 * model cannot choose a recipient, so untrusted generated text cannot be aimed at
 * an arbitrary WeChat account. It carries one text, one local image, or one local
 * file: an image arrives as a picture and a file as a document, because the field
 * names the shape rather than the bytes.
 */

import { basename } from "node:path";
import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { failedResult, textResult } from "../../lib/tool-result.ts";
import {
	callLine,
	elapsedSuffix,
	errorLine,
	rejectionLine,
	startToolProgress,
	syncElapsedTimer,
} from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import type { Bridge, OwnerMessage } from "./bridge.ts";

export const TOOL_NAME = "send_wechat";

const WechatSendParams = Type.Object({
	text: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 4000,
			description: "The message to send to the WeChat owner. Plain text.",
		}),
	),
	image: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 4096,
			description: "Path to a local image to send instead, as a picture. One of text, image, or file.",
		}),
	),
	file: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 4096,
			description:
				"Path to a local file to send instead, as a document. One of text, image, or file; a file that is an image still arrives as a document.",
		}),
	),
});
type WechatSendArgs = Static<typeof WechatSendParams>;

const WechatSendResult = Type.Object({
	sent: Type.Boolean({ description: "Whether the message was delivered to the WeChat backend." }),
	error: Type.Optional(Type.String({ description: "Why the send failed, when sent is false." })),
});

export interface ToolDeps {
	/**
	 * The bridge, or a promise of it: a start is deferred off `session_start`, so the
	 * first turn can arrive while it is still opening, and this reader joins it. A
	 * tool never begins a start — the bridge is opened by hand.
	 */
	getBridge: () => Bridge | undefined | Promise<Bridge | undefined>;
}

function sendResult(sent: boolean, error?: string) {
	const details = error === undefined ? { sent } : { sent, error };
	const structuredContent: Record<string, JsonValue> = { sent };
	if (error !== undefined) structuredContent.error = error;
	const text = sent ? "Sent to the WeChat owner." : `WeChat send failed: ${error ?? "unknown error"}`;
	return sent ? textResult(text, details, structuredContent) : failedResult(text, details, structuredContent);
}

/** The one shape this call carries, or undefined when it names none or several. */
function ownerMessage(args: WechatSendArgs): OwnerMessage | undefined {
	const given = [args.text, args.image, args.file].filter((value) => value !== undefined);
	if (given.length !== 1) return undefined;
	if (args.file !== undefined) return { file: args.file };
	if (args.image !== undefined) return { image: args.image };
	return args.text === undefined ? undefined : { text: args.text };
}

export function registerTools(pi: ExtensionAPI, deps: ToolDeps): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "WeChat send",
		description: [
			"Send a WeChat message — plain text, one local image as a picture, or one local file as a document — to the account owner from the running bridge (start it with /wechat start).",
			"The recipient is always the owner and cannot be chosen.",
		].join(" "),
		promptSnippet: "Send a WeChat text, image, or file to the account owner.",
		promptGuidelines: [
			"Use send_wechat only to message the owner proactively, not to answer an inbound WeChat message (the bridge replies automatically).",
			"Give one of text, image, or file: a plot or screenshot goes as an image path and arrives as a picture, while any other file goes as a file path and arrives as a document.",
			"Keep messages concise and do not include secrets unless the user asked for them.",
		],
		parameters: WechatSendParams,
		outputSchema: WechatSendResult,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, onUpdate) {
			const args = params as WechatSendArgs;
			const message = ownerMessage(args);
			if (message === undefined) {
				return sendResult(false, "Give exactly one of text, image, or file.");
			}
			// After the argument refusal and before every wait, the bridge's own open included: what
			// is left to do here is a network send, so the row says it is working rather than nothing.
			startToolProgress(onUpdate);
			const bridge = await deps.getBridge();
			if (!bridge) {
				return sendResult(false, "WeChat bridge is not started. Run /wechat start first.");
			}
			const outcome = await bridge.sendToOwner(message);
			return sendResult(outcome.ok, outcome.error);
		},

		renderCall(args, theme, context) {
			const { text, image, file } = args as { text?: unknown; image?: unknown; file?: unknown };
			// Media is named by its file, so a call line never carries a whole path.
			const path = typeof file === "string" ? file : image;
			const body = typeof path === "string" ? basename(path) : text;
			const label = context.argsComplete && typeof body === "string" ? body : "…";
			return callLine(theme, context.lastComponent, TOOL_NAME, label);
		},

		renderResult(result, options, theme, context) {
			const startedAt = syncElapsedTimer(options.isPartial, context);
			const text = reuseText(context.lastComponent);
			const details = toolDetails<{ sent?: boolean; error?: string }>(result.details);
			if (options.isPartial) {
				const elapsed = startedAt === undefined ? "" : elapsedSuffix(theme, Date.now() - startedAt);
				text.setText(paint(theme, "warn", "Sending…") + elapsed);
				return text;
			}
			if (details?.sent) {
				text.setText(paint(theme, "ok", "sent to WeChat owner") + elapsedSuffix(theme, context.durationMs));
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
