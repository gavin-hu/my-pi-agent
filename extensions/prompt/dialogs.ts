/**
 * Host-dialog interactions for the refine flow.
 *
 * Everything goes through `ctx.ui` (`custom`, `select`, `input`, `confirm`), so
 * the flow works in TUI and RPC alike and no custom terminal renderer is built.
 * The loader is the one component, and it only covers the clarifier's model
 * call; the questions afterwards use the built-in dialogs.
 */

import { BorderedLoader, type ExtensionContext, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../lib/format.ts";
import { INTERACTION_OTHER_LABEL } from "../../lib/interaction.ts";
import type { Answer, ClarifyQuestion } from "./schema.ts";

/** The slice of the context the loader needs. */
export type LoaderContext = Pick<ExtensionContext, "mode" | "ui" | "signal">;

/**
 * Run `fn` behind a cancellable spinner in interactive mode, and directly
 * everywhere else.
 *
 * Resolves `undefined` when the user cancels with Escape, so the caller can
 * treat cancellation and failure the same way. The loader is only for the
 * model call: a dialog cannot be shown while it owns the editor slot.
 */
export async function withLoader<T>(
	ctx: LoaderContext,
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

/** Answer one question, or `undefined` when the user cancels. */
async function askOne(ui: ExtensionUIContext, question: ClarifyQuestion): Promise<string | undefined> {
	const title = sanitizeLine(question.question);
	if (question.options.length === 0) {
		return ui.input(title, "Your answer");
	}

	// `select` takes plain strings, so a description is folded into the display
	// text and mapped back to the bare label for the recorded answer.
	const labels = new Map<string, string>();
	const displays: string[] = [];
	for (const option of question.options) {
		const label = sanitizeLine(option.label);
		const description = sanitizeLine(option.description ?? "");
		const display = description ? `${label} — ${description}` : label;
		if (labels.has(display)) continue;
		labels.set(display, label);
		displays.push(display);
	}

	const picked = await ui.select(title, [...displays, INTERACTION_OTHER_LABEL]);
	if (picked === undefined) return undefined;
	if (picked === INTERACTION_OTHER_LABEL) return ui.input(title, "Your answer");
	return labels.get(picked) ?? picked;
}

/**
 * Ask every question in order.
 *
 * Cancel (Escape) anywhere abandons the whole refinement and returns
 * `undefined`: nothing is half-applied. Questions the user answers with an empty
 * string are dropped from the result.
 */
export async function askQuestions(
	ui: ExtensionUIContext,
	questions: readonly ClarifyQuestion[],
): Promise<Answer[] | undefined> {
	const answers: Answer[] = [];
	for (const question of questions) {
		const raw = await askOne(ui, question);
		if (raw === undefined) return undefined;
		const answer = sanitizeLine(raw);
		if (!answer) continue;
		answers.push({ header: question.header, question: question.question, answer });
	}
	return answers;
}

/** Confirm the assembled request: the goal plus the answers that produced it. */
export async function confirmRequest(
	ui: ExtensionUIContext,
	goal: string,
	answers: readonly Answer[],
): Promise<boolean> {
	const lines: string[] = [];
	if (goal) lines.push(`Clarified goal: ${goal}`);
	if (answers.length > 0) {
		if (lines.length > 0) lines.push("");
		for (const answer of answers) lines.push(`${answer.header}: ${answer.answer}`);
	}
	return ui.confirm("Submit with this goal?", lines.join("\n"));
}
