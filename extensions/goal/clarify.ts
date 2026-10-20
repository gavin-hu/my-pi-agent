/**
 * Host orchestration for the goal comprehension step: the clarifier call, its
 * cancellable TUI loader, the in-command questionnaire, and the confirm/edit
 * dialog.
 *
 * The loop's target is understanding what the user wants. One call asks the
 * model whether it understands the goal and, when it cannot yet, what it needs
 * to know; the command asks those questions through host dialogs and carries
 * the answers into the editor, where the user confirms or corrects the goal.
 * The flow never throws and never half-applies: a failed, timed-out, cancelled,
 * or unusable comprehension falls back to the text the user typed, and a
 * dismissed dialog cancels the whole command.
 */

import { BorderedLoader, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UserMessage } from "@earendil-works/pi-ai";
import { sanitizeLine } from "../../lib/format.ts";
import { type Clarification, type ClarifyAnswer, type ClarifyQuestion, parseClarification } from "./clarify-parse.ts";
import { buildClarifyMessages } from "./clarify-prompt.ts";

/** Bound on the clarifier model call, in milliseconds. */
const CLARIFY_TIMEOUT_MS = 30_000;

/** The slice of the context the clarify step reads. */
export type ClarifyContext = Pick<ExtensionContext, "mode" | "ui" | "signal" | "hasUI" | "model" | "modelRegistry">;

/** Loader text shown while the comprehension call runs. */
const LOADER_MESSAGE = "Understanding goal…";

/** The confirm/edit dialog title, reading as a confirmation of understanding. */
const EDITOR_TITLE = "Confirm the goal — Enter to save, Esc to cancel";

/**
 * Sentinel line above the answer notes in the confirm editor. Everything below
 * it is dropped on save, so accepting the prefill records the goal alone.
 */
export const NOTES_FENCE = "--- notes (not saved) ---";

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

/**
 * One clarifier model call, behind the TUI loader.
 *
 * The call is aborted on timeout, on the session signal, or when the loader is
 * cancelled, and any failure becomes `undefined` so a provider error never
 * blocks the command. Nothing from the conversation is sent: the model must not
 * invent scope the user did not state.
 */
async function askClarifier(
	ctx: ClarifyContext,
	buildMessages: () => { systemPrompt: string; messages: UserMessage[] },
): Promise<string | undefined> {
	const model = ctx.model;
	if (!model) return undefined;

	const { systemPrompt, messages } = buildMessages();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), CLARIFY_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	ctx.signal?.addEventListener("abort", onAbort, { once: true });
	try {
		return await withLoader(ctx, LOADER_MESSAGE, async (signal) => {
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
}

/**
 * The comprehension call, parsed into a {@link Clarification}.
 *
 * Returns `undefined` when there is no dialog UI or no model, or when the call
 * fails, times out, is cancelled, or returns nothing usable.
 */
export async function clarifyGoalPrompt(ctx: ClarifyContext, text: string): Promise<Clarification | undefined> {
	if (!ctx.hasUI || !ctx.model) return undefined;
	return parseClarification(await askClarifier(ctx, () => buildClarifyMessages(text)));
}

/**
 * Ask the clarifier's questions through host dialogs, one at a time.
 *
 * A question with options uses a selector; a free-form question uses a text
 * input. Resolves `undefined` when any dialog is dismissed, so the caller cancels
 * the whole command; an empty answer is skipped. The answer is sanitized to one
 * line, since it is folded into the goal the editor holds.
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
 * Carry the answers into the editor as notes under the restatement, below
 * {@link NOTES_FENCE}.
 *
 * No model call rewrites the goal from the answers, so they are shown verbatim
 * with the question that asked for them: the user folds them into the sentence
 * above the fence, and the notes themselves are dropped on save.
 */
function withAnswers(goal: string, answers: readonly ClarifyAnswer[]): string {
	if (answers.length === 0) return goal;
	const notes = answers.map((answer) => `Also: ${answer.question} → ${answer.answer}`);
	return [goal, "", NOTES_FENCE, ...notes].join("\n");
}

/**
 * Drop the answer notes from the editor's text.
 *
 * They are scaffolding, so the default exit (Enter over the prefill) records the
 * goal alone instead of the questions it was asked. Cutting at the fence rather
 * than at each `Also:` line keeps a goal that itself starts a line with `Also:`
 * intact, and deleting the fence keeps everything below it — the escape hatch
 * for text the user meant to save.
 */
export function stripNotes(text: string): string {
	const lines = text.split(/\r?\n/);
	const fence = lines.findIndex((line) => line.trim() === NOTES_FENCE);
	return fence === -1 ? text : lines.slice(0, fence).join("\n").trim();
}

/** Open the confirm/edit dialog, or cancel when it is dismissed. */
async function editOrCancel(ctx: ClarifyContext, prefill: string): Promise<GoalPromptOutcome> {
	const edited = await ctx.ui.editor(EDITOR_TITLE, prefill);
	return edited === undefined ? { action: "cancel" } : { action: "use", text: stripNotes(edited) };
}

/**
 * Run the understanding loop for `/goal <prompt>`: comprehend, ask what is
 * missing, then let the user confirm or correct the goal.
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
		proposed = withAnswers(proposed, answers);
	}
	return editOrCancel(ctx, proposed);
}
