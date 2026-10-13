/**
 * Host orchestration for the goal clarify step: the nested clarifier call, its
 * cancellable TUI loader, and the confirm/edit dialog.
 *
 * The flow never throws and never half-applies: a failed, timed-out, cancelled,
 * or unusable clarification falls back to the text the user typed, and a
 * dismissed confirm/edit dialog cancels the whole command.
 */

import { BorderedLoader, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Clarification, type ClarifyQuestion, parseClarification } from "./clarify-parse.ts";
import { buildClarifyMessages } from "./clarify-prompt.ts";

/** Bound on the clarifier model call, in milliseconds. */
export const CLARIFY_TIMEOUT_MS = 30_000;

/** The slice of the context the clarify step reads. */
export type ClarifyContext = Pick<ExtensionContext, "mode" | "ui" | "signal" | "hasUI" | "model" | "modelRegistry">;

/** Loader text shown while the clarifier runs. */
const LOADER_MESSAGE = "Clarifying goal…";

/** The confirm/edit dialog title, spelling out both exits. */
const EDITOR_TITLE = "Goal prompt — Enter to accept, Esc to cancel";

/** What {@link prepareGoalPrompt} decided: use this text, ask before setting, or cancel. */
export type GoalPromptOutcome =
	| { action: "use"; text: string }
	| { action: "ask"; original: string; goal: string; questions: ClarifyQuestion[] }
	| { action: "cancel" };

/**
 * Run `fn` behind a cancellable spinner in interactive mode, and directly
 * everywhere else.
 *
 * Resolves `undefined` when the user cancels with Escape, so the caller treats
 * cancellation and failure alike. The loader covers only the model call: a
 * dialog cannot be shown while it owns the editor slot.
 */
export async function withLoader<T>(
	ctx: Pick<ClarifyContext, "mode" | "ui" | "signal">,
	message: string,
	fn: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T | undefined> {
	if (ctx.mode !== "tui") return fn(ctx.signal);
	return ctx.ui.custom<T | undefined>((tui, theme, _keybindings, done) => {
		const loader = new BorderedLoader(tui, theme, message);
		let settled = false;
		const finish = (value: T | undefined): void => {
			if (settled) return;
			settled = true;
			done(value);
		};
		loader.onAbort = () => finish(undefined);
		fn(loader.signal).then(finish, () => finish(undefined));
		return loader;
	});
}

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

/** Runs a nested operation, optionally behind the TUI loader. */
export type CompleterRun = <T>(fn: (signal: AbortSignal | undefined) => Promise<T>) => Promise<T | undefined>;

/** The context slice the completer needs. */
type CompleterContext = Pick<ExtensionContext, "model" | "modelRegistry" | "signal">;

/**
 * Build the clarifier caller.
 *
 * The call runs through `run` (the loader wrapper) with an `AbortController`
 * aborted on timeout, on the session signal, or when the loader is cancelled.
 * Any throw becomes `undefined`, so a provider failure never blocks the command.
 */
export function createCompleter(
	ctx: CompleterContext,
	timeoutMs: number,
	run: CompleterRun,
): (text: string) => Promise<string | undefined> {
	return async (text) => {
		const model = ctx.model;
		if (!model) return undefined;

		const { systemPrompt, messages } = buildClarifyMessages(text);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const onAbort = () => controller.abort();
		ctx.signal?.addEventListener("abort", onAbort, { once: true });
		try {
			return await run(async (signal) => {
				if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
				const response = await ctx.modelRegistry.complete(
					model,
					{ systemPrompt, messages },
					{ signal: controller.signal, cacheRetention: "none" },
				);
				if (response.stopReason === "aborted") return undefined;
				return assistantText(response);
			});
		} catch {
			return undefined;
		} finally {
			clearTimeout(timer);
			ctx.signal?.removeEventListener("abort", onAbort);
		}
	};
}

/**
 * One clarifier call on the session model, parsed into a {@link Clarification}.
 *
 * Returns `undefined` when there is no dialog UI or no model, or when the call
 * fails, times out, is cancelled, or returns nothing usable.
 */
export async function clarifyGoalPrompt(ctx: ClarifyContext, text: string): Promise<Clarification | undefined> {
	if (!ctx.hasUI || !ctx.model) return undefined;
	const complete = createCompleter(ctx, CLARIFY_TIMEOUT_MS, (run) => withLoader(ctx, LOADER_MESSAGE, run));
	return parseClarification(await complete(text));
}

/**
 * Prepare the goal text for `/goal <prompt>`: classify, then confirm, edit, or
 * delegate the clarifying questions.
 *
 * Without a dialog UI or a model the typed text is used unchanged, so the
 * command never blocks on clarification in print or JSON mode. When the
 * clarifier is unclear and `canAsk` (the question tool is available), the
 * questions are returned for the caller to delegate to the agent; otherwise the
 * proposed goal opens in the confirm/edit dialog. A dismissed dialog cancels the
 * command.
 */
export async function prepareGoalPrompt(
	ctx: ClarifyContext,
	typed: string,
	canAsk: boolean,
): Promise<GoalPromptOutcome> {
	if (!ctx.hasUI || !ctx.model) return { action: "use", text: typed };
	const clarification = await clarifyGoalPrompt(ctx, typed);

	if (clarification && !clarification.clear && canAsk) {
		return { action: "ask", original: typed, goal: clarification.goal, questions: clarification.questions };
	}

	const edited = await ctx.ui.editor(EDITOR_TITLE, clarification?.goal || typed);
	return edited === undefined ? { action: "cancel" } : { action: "use", text: edited };
}
