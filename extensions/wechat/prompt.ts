/**
 * Pure rendering and parsing of remote dialog prompts (no I/O).
 *
 * A prompt is rendered to a WeChat message by {@link formatPrompt}; the reply is
 * interpreted by {@link parsePromptAnswer}. Hints are bilingual (Chinese and
 * English) so either reader can answer, and {@link formatPrompt} can prepend a
 * short notice when a reply was not understood. The parser is deliberately total:
 * anything it cannot resolve reports `retry`, and free text on a `select` becomes
 * the {@link INTERACTION_OTHER_LABEL} option so the caller can collect it once.
 */

import { INTERACTION_OTHER_LABEL, type InteractionRequest } from "../../lib/interaction.ts";
import { sanitizeInbound } from "./format.ts";

/** A parsed reply: a resolved answer, the "other" choice, or a retry. */
export type PromptParse =
	| { kind: "value"; value: string }
	| { kind: "other"; text: string }
	| { kind: "confirmed"; confirmed: boolean }
	| { kind: "cancelled" }
	| { kind: "retry" };

const SELECT_OTHER_HINT =
	"回复编号或选项文字；其它内容作为自定义回答；回复「取消」或 cancel 跳过。\n" +
	"Reply with a number or the option text; anything else becomes your own answer; reply cancel to dismiss.";
const SELECT_CHOICE_HINT =
	"回复编号或选项文字；回复「取消」或 cancel 跳过。\n" +
	"Reply with a number or the option text; reply cancel to dismiss.";
const CONFIRM_HINT = "回复「是」或「否」。\nReply yes or no.";
const INPUT_HINT = "直接回复内容；回复「取消」或 cancel 跳过。\nReply with the text; reply cancel to skip.";
const EDITOR_HINT =
	"把内容作为一条消息发回；回复「取消」或 cancel 取消。\nSend the text as one message; reply cancel to cancel.";

/** Sent ahead of a re-prompt when a reply could not be interpreted. */
export const RETRY_NOTICE =
	"没有识别到有效回复，请重新回答。\nSorry, I didn't recognize that reply — please answer again.";

const CANCEL_WORDS = new Set(["取消", "退出", "cancel", "quit", "exit"]);
const YES_WORDS = new Set(["是", "y", "yes", "1", "确认", "确定", "行", "ok", "好", "对"]);
const NO_WORDS = new Set(["否", "n", "no", "0", "不", "不是", "不行"]);

function lines(parts: Array<string | undefined>): string {
	return parts.filter((part): part is string => part !== undefined && part !== "").join("\n");
}

/** Render a dialog prompt as a WeChat message body, optionally after a retry. */
export function formatPrompt(request: InteractionRequest, options: { retry?: boolean } = {}): string {
	const body = promptBody(request);
	return options.retry ? `${RETRY_NOTICE}\n\n${body}` : body;
}

function promptBody(request: InteractionRequest): string {
	switch (request.kind) {
		case "select": {
			const options = (request.options ?? []).map((label, index) => `${index + 1}. ${label}`);
			const hasOther = (request.options ?? []).includes(INTERACTION_OTHER_LABEL);
			return lines([request.title, ...options, hasOther ? SELECT_OTHER_HINT : SELECT_CHOICE_HINT]);
		}
		case "confirm":
			return lines([request.title, request.message, CONFIRM_HINT]);
		case "input":
			return lines([request.title, request.placeholder, INPUT_HINT]);
		case "editor":
			return lines([request.title, request.prefill, EDITOR_HINT]);
	}
}

/**
 * Cancel intent, including the phrases a phone user naturally types.
 * Exact words keep the old meaning; the two patterns cover “退出 plan 模式” and
 * “exit plan mode” without treating a sentence such as “exit code” as a cancel.
 */
function isCancelIntent(text: string, lower: string): boolean {
	if (CANCEL_WORDS.has(lower)) return true;
	if (/^(退出|离开)\s*(计划|plan)/i.test(text)) return true;
	return /^(exit|leave)\s+(the\s+)?plan\b/i.test(text);
}

/** Interpret a WeChat reply to `request`. */
export function parsePromptAnswer(request: InteractionRequest, raw: string): PromptParse {
	const text = sanitizeInbound(raw);
	const lower = text.toLowerCase();

	if (isCancelIntent(text, lower)) {
		return request.kind === "confirm" ? { kind: "confirmed", confirmed: false } : { kind: "cancelled" };
	}

	switch (request.kind) {
		case "confirm": {
			if (YES_WORDS.has(lower)) return { kind: "confirmed", confirmed: true };
			if (NO_WORDS.has(lower)) return { kind: "confirmed", confirmed: false };
			return { kind: "retry" };
		}
		case "select": {
			if (text === "") return { kind: "retry" };
			const options = request.options ?? [];
			// A bare number is always read as an option index; an out-of-range one is
			// a likely typo, so retry rather than falling through to "Other".
			if (/^\d+$/.test(text)) {
				const asNumber = Number.parseInt(text, 10);
				return asNumber >= 1 && asNumber <= options.length
					? { kind: "value", value: options[asNumber - 1] }
					: { kind: "retry" };
			}
			const match = options.find((label) => label.toLowerCase() === lower);
			if (match) return { kind: "value", value: match };
			if (options.at(-1) === INTERACTION_OTHER_LABEL) return { kind: "other", text };
			return { kind: "retry" };
		}
		case "input": {
			if (text === "") return { kind: "retry" };
			return { kind: "value", value: text };
		}
		case "editor": {
			if (text === "") return { kind: "cancelled" };
			return { kind: "value", value: text };
		}
	}
}
