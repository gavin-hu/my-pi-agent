/**
 * The refine orchestration: when to run, how the clarifier is called, and how
 * its reply becomes a transformed prompt.
 *
 * Both seams are injected (`complete`, `ask`, `confirm`) so the flow is unit
 * testable without a model, a terminal, or a session. `index.ts` wires the real
 * host implementations.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildClarifyMessages, buildClarifyUserText, buildRefinedPrompt, clarifySystemPrompt } from "./clarifier.ts";
import type { PromptConfig } from "./config.ts";
import { type Answer, type ClarifyQuestion, parseClarification } from "./schema.ts";

/** The cheap, local facts that decide whether a model call is worth making. */
export interface RefineGate {
	/** Effective on/off state (config plus any session override). */
	enabled: boolean;
	/** Whether dialog-capable UI is available (TUI or RPC). */
	hasUI: boolean;
	/** Whether a session model is selected. */
	hasModel: boolean;
	/** Whether the agent is idle. */
	isIdle: boolean;
	/** Where the input came from; `extension` inputs are never refined. */
	source: string;
	/** Whether the input is steering or following up a run in progress. */
	streaming: boolean;
	/** The submitted text. */
	text: string;
	/** Prompts shorter than this are never refined. */
	minLength: number;
	/** True while another refinement is in flight. */
	busy: boolean;
}

/** Whether a submitted prompt should go through refinement. */
export function shouldRefine(gate: RefineGate): boolean {
	if (!gate.enabled || !gate.hasUI || !gate.hasModel) return false;
	if (gate.busy || !gate.isIdle) return false;
	if (gate.source === "extension" || gate.streaming) return false;
	const text = gate.text.trim();
	if (text.length < gate.minLength) return false;
	// Slash commands and `!` bash are already dispatched by Pi before this point;
	// anything reaching here with that shape is not a request to clarify.
	if (text.startsWith("/") || text.startsWith("!")) return false;
	return true;
}

/** What the input handler returns: pass the prompt through, or replace it. */
export type RefineOutcome = { action: "continue" } | { action: "transform"; text: string };

/** The injected host operations. */
export interface RefineDeps {
	/** Run the clarifier; `undefined` means it failed, timed out, or was cancelled. */
	complete: (systemPrompt: string, userText: string) => Promise<string | undefined>;
	/** Ask the questions; `undefined` means the user cancelled. */
	ask: (questions: readonly ClarifyQuestion[]) => Promise<Answer[] | undefined>;
	/** Confirm the assembled request; `false` cancels. */
	confirm: (goal: string, answers: readonly Answer[]) => Promise<boolean>;
}

export interface RefineRequest {
	text: string;
	config: PromptConfig;
	history: string;
	deps: RefineDeps;
}

/**
 * Run the refine flow for one submitted prompt.
 *
 * Never rejects and never half-applies: every failure (a throwing seam, an
 * unparseable reply, a cancelled dialog, a declined goal) resolves to
 * `{ action: "continue" }`, which submits the user's original prompt unchanged.
 */
export async function refinePrompt(request: RefineRequest): Promise<RefineOutcome> {
	try {
		const { text, config, history, deps } = request;
		const raw = await deps.complete(clarifySystemPrompt(config.maxQuestions), buildClarifyUserText(text, history));
		if (raw === undefined) return { action: "continue" };

		const clarification = parseClarification(raw, config.maxQuestions);
		if (!clarification || clarification.clear || clarification.questions.length === 0) {
			return { action: "continue" };
		}

		const answers = await deps.ask(clarification.questions);
		if (answers === undefined || answers.length === 0) return { action: "continue" };

		if (config.confirmGoal && !(await deps.confirm(clarification.goal, answers))) {
			return { action: "continue" };
		}

		return { action: "transform", text: buildRefinedPrompt(text, clarification.goal, answers) };
	} catch {
		return { action: "continue" };
	}
}

/** Runs a nested operation, optionally behind the TUI loader. */
export type CompleterRun = <T>(fn: (signal: AbortSignal | undefined) => Promise<T>) => Promise<T | undefined>;

/** The context slice the completer needs. */
export type CompleterContext = Pick<ExtensionContext, "model" | "modelRegistry">;

/** The text parts of an assistant message, joined. */
function assistantText(response: { content?: unknown }): string {
	if (!Array.isArray(response.content)) return "";
	const parts: string[] = [];
	for (const part of response.content) {
		if (!part || typeof part !== "object") continue;
		const record = part as { type?: unknown; text?: unknown };
		if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
	}
	return parts.join("\n");
}

/**
 * Build the clarifier caller.
 *
 * The call runs through `run` (the loader wrapper) with an `AbortController`
 * that is aborted on `timeoutMs` or when the loader is cancelled. Any throw
 * becomes `undefined`, so a provider failure never blocks the prompt.
 */
export function createCompleter(
	ctx: CompleterContext,
	timeoutMs: number,
	run: CompleterRun,
): (systemPrompt: string, userText: string) => Promise<string | undefined> {
	return async (systemPrompt, userText) => {
		const model = ctx.model;
		if (!model) return undefined;

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await run(async (signal) => {
				if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
				const response = await ctx.modelRegistry.complete(model, buildClarifyMessages(systemPrompt, userText), {
					signal: controller.signal,
					cacheRetention: "none",
				});
				if (response.stopReason === "aborted") return undefined;
				return assistantText(response);
			});
		} catch {
			return undefined;
		} finally {
			clearTimeout(timer);
		}
	};
}
