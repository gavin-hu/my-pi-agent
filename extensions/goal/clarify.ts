/**
 * Host orchestration for the goal comprehension step: the nested clarifier
 * calls, their cancellable TUI loaders, the in-command questionnaire, and the
 * confirm/edit dialog.
 *
 * The loop's target is understanding what the user wants. The first call asks
 * the model whether it understands the goal and, if not, what it needs to know;
 * the command asks those questions through host dialogs; a second call folds the
 * answers into the final restatement; the editor lets the user confirm or
 * correct it. The flow never throws and never half-applies: a failed,
 * timed-out, cancelled, or unusable comprehension falls back to the text the
 * user typed, and a dismissed dialog cancels the whole command.
 */

import { BorderedLoader, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UserMessage } from "@earendil-works/pi-ai";
import { sanitizeLine } from "../../lib/format.ts";
import { type Clarification, type ClarifyAnswer, type ClarifyQuestion, parseClarification } from "./clarify-parse.ts";
import { buildClarifyMessages, buildRefineMessages } from "./clarify-prompt.ts";

/** Bound on each clarifier model call, in milliseconds. */
const CLARIFY_TIMEOUT_MS = 30_000;

/** The slice of the context the clarify step reads. */
export type ClarifyContext = Pick<ExtensionContext, "mode" | "ui" | "signal" | "hasUI" | "model" | "modelRegistry">;

/** Loader text shown while the comprehension call runs. */
const LOADER_MESSAGE = "Understanding goal…";

/** Loader text shown while the goal is restated from the answers. */
const REFINE_LOADER_MESSAGE = "Updating the goal…";

/** The confirm/edit dialog title, reading as a confirmation of understanding. */
const EDITOR_TITLE = "Confirm the goal — Enter to save, Esc to cancel";

/** What {@link prepareGoalPrompt} decided: use this text, or cancel. */
export type GoalPromptOutcome = { action: "use"; text: string } | { action: "cancel" };

/**
 * Run `fn` behind a cancellable spinner in interactive mode, and directly
 * everywhere else.
 *
 * Resolves `undefined` when the user cancels with Escape, so the caller treats
 * cancellation and failure alike. The loader covers only the model call: a
 * dialog cannot be shown while it owns the editor slot, and it deliberately
 * leaves the above-editor rails visible — it is only a few lines tall, and
 * hiding the goal and todo for a transient call would just flicker. A full dock
 * screen (the `question` questionnaire) is what suppresses the rails.
 */
async function withLoader<T>(
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
type CompleterRun = <T>(fn: (signal: AbortSignal | undefined) => Promise<T>) => Promise<T | undefined>;

/** The context slice the completer needs. */
type CompleterContext = Pick<ExtensionContext, "model" | "modelRegistry" | "signal">;

/**
 * Build one clarifier caller.
 *
 * `buildMessages` produces the request; the call runs through `run` (the loader
 * wrapper) with an `AbortController` aborted on timeout, on the session signal,
 * or when the loader is cancelled. Any throw becomes `undefined`, so a provider
 * failure never blocks the command.
 */
function createCompleter(
	ctx: CompleterContext,
	timeoutMs: number,
	run: CompleterRun,
	buildMessages: () => { systemPrompt: string; messages: UserMessage[] },
): () => Promise<string | undefined> {
	return async () => {
		const model = ctx.model;
		if (!model) return undefined;

		const { systemPrompt, messages } = buildMessages();
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

/** Run one clarifier call behind its loader and return the raw reply. */
async function completeOnce(
	ctx: ClarifyContext,
	loaderMessage: string,
	buildMessages: () => { systemPrompt: string; messages: UserMessage[] },
): Promise<string | undefined> {
	return createCompleter(ctx, CLARIFY_TIMEOUT_MS, (run) => withLoader(ctx, loaderMessage, run), buildMessages)();
}

/**
 * One comprehension call on the session model, parsed into a
 * {@link Clarification}.
 *
 * Returns `undefined` when there is no dialog UI or no model, or when the call
 * fails, times out, is cancelled, or returns nothing usable.
 */
export async function clarifyGoalPrompt(ctx: ClarifyContext, text: string): Promise<Clarification | undefined> {
	if (!ctx.hasUI || !ctx.model) return undefined;
	return parseClarification(await completeOnce(ctx, LOADER_MESSAGE, () => buildClarifyMessages(text)));
}

/**
 * Ask the clarifier's questions through host dialogs, one at a time.
 *
 * A question with options uses a selector; a free-form question uses a text
 * input. Resolves `undefined` when any dialog is dismissed, so the caller cancels
 * the whole command; an empty answer is skipped. The answer is sanitized to one
 * line, since it is folded into a model message and later the goal.
 */
async function askQuestions(
	ctx: Pick<ClarifyContext, "ui">,
	questions: readonly ClarifyQuestion[],
): Promise<ClarifyAnswer[] | undefined> {
	const answers: ClarifyAnswer[] = [];
	for (const question of questions) {
		const answer =
			question.options.length > 0
				? await ctx.ui.select(
						question.question,
						question.options.map((option) => option.label),
					)
				: await ctx.ui.input(question.question);
		if (answer === undefined) return undefined;
		const sanitized = sanitizeLine(answer);
		if (sanitized) answers.push({ question: question.question, answer: sanitized });
	}
	return answers;
}

/**
 * Fold the user's answers into the final restatement of the goal.
 *
 * Returns `undefined` on any failure, so the caller falls back to the first
 * restatement.
 */
async function refineWithAnswers(
	ctx: ClarifyContext,
	original: string,
	goal: string,
	answers: readonly ClarifyAnswer[],
): Promise<string | undefined> {
	const reply = await completeOnce(ctx, REFINE_LOADER_MESSAGE, () => buildRefineMessages(original, goal, answers));
	return parseClarification(reply)?.goal || undefined;
}

/** Open the confirm/edit dialog, or cancel when it is dismissed. */
async function editOrCancel(ctx: ClarifyContext, prefill: string): Promise<GoalPromptOutcome> {
	const edited = await ctx.ui.editor(EDITOR_TITLE, prefill);
	return edited === undefined ? { action: "cancel" } : { action: "use", text: edited };
}

/**
 * Run the understanding loop for `/goal <prompt>`: comprehend, ask what is
 * missing, re-comprehend, then let the user confirm or correct the goal.
 *
 * Without a dialog UI or a model the typed text is used unchanged, so the
 * command never blocks on the loop in print or JSON mode. A failed comprehension
 * keeps the typed text with a notice; a dismissed question or editor cancels the
 * command.
 */
export async function prepareGoalPrompt(ctx: ClarifyContext, typed: string): Promise<GoalPromptOutcome> {
	if (!ctx.hasUI || !ctx.model) return { action: "use", text: typed };

	const clarification = await clarifyGoalPrompt(ctx, typed);
	if (!clarification) {
		ctx.ui.notify("Could not confirm the goal; keeping your wording.", "info");
		return editOrCancel(ctx, typed);
	}

	let proposed = clarification.goal || typed;
	if (!clarification.understood && clarification.questions.length > 0) {
		const answers = await askQuestions(ctx, clarification.questions);
		if (answers === undefined) {
			ctx.ui.notify("Goal not set.", "info");
			return { action: "cancel" };
		}
		if (answers.length > 0) {
			const refined = await refineWithAnswers(ctx, typed, proposed, answers);
			if (refined) proposed = refined;
			else ctx.ui.notify("Could not update the goal from your answers; edit it below.", "info");
		}
	}
	return editOrCancel(ctx, proposed);
}
