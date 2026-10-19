/**
 * The `/rewind` orchestration.
 *
 * Restores the working tree (through the snapshot runtime), the conversation
 * (through session-tree navigation), or both, after a single scope choice and
 * confirmation. Code restore is applied first, so the re-rendered transcript
 * reflects the restored files; conversation navigation is last because it
 * replaces the chat view and repopulates the editor.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { withRailsSuppressed } from "../../lib/rails.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatChangeSummary, formatRestoreText, previewDiffText } from "./format.ts";
import { PathPickerComponent } from "./path-picker.ts";
import type { ChangedPath } from "./paths.ts";
import type { RewindRuntime } from "./runtime.ts";
import { rewindScopes, type RewindPoint, type RewindScope } from "./timeline.ts";

/** Human labels for the scope picker, in menu order. */
const SCOPE_LABELS: Record<RewindScope, string> = {
	both: "Code and conversation",
	conversation: "Conversation only",
	code: "Code only",
};

/** One-line description of what a scope will do. */
function scopeDescription(scope: RewindScope): string {
	if (scope === "both") {
		return "Rewinds the working tree and moves the conversation back to this prompt.";
	}
	if (scope === "code") {
		return "Rewinds the working tree. The conversation stays where it is.";
	}
	return "Moves the conversation back to this prompt and puts it in the editor. Files are untouched.";
}

/** Pick a scope: the only one available, or ask when a snapshot offers a choice. */
async function chooseScope(
	ctx: ExtensionCommandContext,
	point: RewindPoint,
	scopes: RewindScope[],
): Promise<RewindScope | undefined> {
	if (scopes.length === 1) return scopes[0];
	const labels = scopes.map((scope) => SCOPE_LABELS[scope]);
	const label = point.summary || point.prompt || "this prompt";
	const chosen = await ctx.ui.select(`Rewind to "${label}"`, labels);
	if (!chosen) return undefined;
	const index = labels.indexOf(chosen);
	return index >= 0 ? scopes[index] : undefined;
}

/** Build the combined confirm body, including the diff preview when code moves. */
function confirmBody(
	scope: RewindScope,
	changeSummary: string | undefined,
	diff: string | undefined,
	subset?: { selected: number; total: number },
): string {
	const lines = [scopeDescription(scope)];
	if (subset) lines.push(`Restoring ${subset.selected} of ${subset.total} changed files.`);
	if (changeSummary) lines.push(`${changeSummary} since the snapshot. HEAD is untouched.`);
	if (diff) lines.push("", previewDiffText(diff));
	if (scope !== "code") lines.push("", "This prompt returns to the editor so you can edit and resubmit.");
	return lines.join("\n");
}

/** What the path step decided: the whole tree, a chosen subset, or nothing. */
export type PathChoice = { kind: "all" } | { kind: "some"; paths: string[] } | { kind: "cancel" };

/** The two answers the path step offers before the checklist opens. */
const ALL_LABEL = (count: number): string => `Everything (${count} file${count === 1 ? "" : "s"})`;
const SOME_LABEL = "Choose paths…";

/**
 * Ask which paths to restore. The checklist needs a list only a TUI can mount, so
 * every other mode keeps the whole-tree restore rather than inventing a typed
 * syntax with its own parser and preview.
 */
export async function choosePaths(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	paths: readonly ChangedPath[],
): Promise<PathChoice> {
	if (ctx.mode !== "tui" || paths.length === 0) return { kind: "all" };

	const choice = await ctx.ui.select("Restore what?", [ALL_LABEL(paths.length), SOME_LABEL]);
	if (choice === undefined) return { kind: "cancel" };
	if (choice !== SOME_LABEL) return { kind: "all" };

	const selected = await withRailsSuppressed(pi, () =>
		ctx.ui.custom<string[] | undefined>(
			(tui, theme, _keybindings, done) =>
				new PathPickerComponent({
					paths,
					theme,
					onClose: (subset) => done(subset),
					requestRender: () => tui.requestRender(),
					viewportRows: () => tui.terminal?.rows,
				}),
		),
	);
	if (!selected) return { kind: "cancel" };
	// An empty checklist is a choice, not a cancel: it restores no files and still
	// moves the conversation, which is what the confirm describes.
	return { kind: "some", paths: selected };
}

/**
 * Rewind to `point` with the chosen scope. Interactive only: callers guard on
 * `ctx.hasUI`. Returns true when something was applied.
 */
export async function rewindTo(
	pi: ExtensionAPI,
	runtime: RewindRuntime,
	ctx: ExtensionCommandContext,
	root: string | undefined,
	point: RewindPoint,
): Promise<boolean> {
	// `navigateTree` throws while streaming.
	if (!ctx.isIdle()) await ctx.waitForIdle();

	const scope = await chooseScope(ctx, point, rewindScopes(point));
	if (!scope) {
		ctx.ui.notify("Rewind cancelled.", "info");
		return false;
	}

	const snapshot = scope === "conversation" ? undefined : point.snapshot;
	if ((scope === "both" || scope === "code") && (!snapshot || !root)) {
		ctx.ui.notify("No code snapshot is available for this prompt.", "warning");
		return false;
	}

	let plan;
	/** The subset to restore, when the path step narrowed the plan. */
	let selection: string[] | undefined;
	let total = 0;
	if (snapshot && root) {
		const result = await runtime.plan(root, snapshot);
		if (!result.ok) {
			ctx.ui.notify(result.reason, "warning");
			return false;
		}
		plan = result.plan;
		total = plan.paths.length;
		if (plan.paths.length > 0) {
			const choice = await choosePaths(pi, ctx, plan.paths);
			if (choice.kind === "cancel") {
				ctx.ui.notify("Rewind cancelled.", "info");
				return false;
			}
			if (choice.kind === "some") {
				selection = choice.paths;
				const narrowed = await runtime.plan(root, snapshot, selection);
				if (!narrowed.ok) {
					ctx.ui.notify(narrowed.reason, "warning");
					return false;
				}
				plan = narrowed.plan;
			}
		}
	}

	const label = point.summary || point.prompt || "this prompt";
	const approved = await ctx.ui.confirm(
		`Rewind to "${label}"?`,
		confirmBody(
			scope,
			plan ? formatChangeSummary(plan.changed, plan.removed) : undefined,
			plan?.diff,
			selection ? { selected: plan?.paths.length ?? 0, total } : undefined,
		),
	);
	if (!approved) {
		ctx.ui.notify("Rewind cancelled.", "info");
		return false;
	}

	const notes: string[] = [];
	if (snapshot && root) {
		try {
			const restored = await runtime.restore(ctx, root, snapshot, runtime.configFor(root), selection);
			await runtime.setStatus(ctx);
			notes.push(formatRestoreText(restored));
		} catch (error) {
			ctx.ui.notify(`Rewind failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			return false;
		}
	}

	if (scope !== "code") {
		// `navigateTree` is a no-op when the target is already the leaf (a session
		// whose last entry is the user message, e.g. after an interrupt). It then
		// never reports editor text, so restore the prompt ourselves.
		const alreadyAtLeaf = ctx.sessionManager.getLeafId() === point.entryId;
		const result = await ctx.navigateTree(point.entryId);
		if (result.cancelled) {
			ctx.ui.notify(`${notes.join(" ")} Conversation rewind cancelled.`.trim(), "warning");
			return notes.length > 0;
		}
		if (alreadyAtLeaf) {
			restoreEditorText(ctx, point.prompt);
			notes.push(`Conversation is already at #${point.entryId}; the prompt is back in the editor.`);
		} else {
			notes.push(`Conversation rewound to #${point.entryId}. Edit the prompt and resubmit to continue.`);
		}
	}

	ctx.ui.notify(notes.join(" "), "info");
	return true;
}

/** Put the prompt back in the editor without clobbering text the user already typed. */
function restoreEditorText(ctx: ExtensionCommandContext, prompt: string): void {
	try {
		const current = ctx.ui.getEditorText?.();
		if (current !== undefined && current.trim() !== "") return;
		ctx.ui.setEditorText?.(prompt);
	} catch {
		// Editor methods are unavailable in headless or RPC modes.
	}
}
