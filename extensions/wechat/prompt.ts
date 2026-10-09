/**
 * Pure rendering and parsing of remote dialog prompts (no I/O).
 *
 * A prompt is rendered to a WeChat message by {@link formatPrompt}; the reply is
 * interpreted by {@link parsePromptAnswer}. The parser is deliberately total:
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

const SELECT_HINT = "回复编号或选项文字;回复其它内容视为「Other」。回复「取消」跳过。";
const CONFIRM_HINT = "回复「是」或「否」。";
const INPUT_HINT = "直接回复内容;回复「取消」跳过。";
const EDITOR_HINT = "把内容作为一条消息发回;回复「取消」取消。";

const CANCEL_WORDS = new Set(["取消", "cancel", "quit", "exit"]);
const YES_WORDS = new Set(["是", "y", "yes", "1", "确认", "ok", "好", "对"]);
const NO_WORDS = new Set(["否", "n", "no", "0", "不"]);

function lines(parts: Array<string | undefined>): string {
	return parts.filter((part): part is string => part !== undefined && part !== "").join("\n");
}

/** Render a dialog prompt as a WeChat message body. */
export function formatPrompt(request: InteractionRequest): string {
	switch (request.kind) {
		case "select": {
			const options = (request.options ?? []).map((label, index) => `${index + 1}. ${label}`);
			return lines([request.title, ...options, SELECT_HINT]);
		}
		case "confirm":
			return lines([request.title, request.message, CONFIRM_HINT]);
		case "input":
			return lines([request.title, request.placeholder, INPUT_HINT]);
		case "editor":
			return lines([request.title, request.prefill, EDITOR_HINT]);
	}
}

/** Interpret a WeChat reply to `request`. */
export function parsePromptAnswer(request: InteractionRequest, raw: string): PromptParse {
	const text = sanitizeInbound(raw);
	const lower = text.toLowerCase();

	if (lower !== "" && CANCEL_WORDS.has(lower)) {
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
