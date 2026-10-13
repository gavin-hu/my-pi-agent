/**
 * file-explorer — open files and directories in the OS-native app.
 *
 * Registers the `/open` command and the `open_path` tool. The tool is
 * `codemode`-exposed, so a script (or `tool_search`) can open or reveal a path
 * without adding it to every request. Nothing is held between calls, so there is
 * no session lifecycle to manage.
 *
 * Load with:  pi --extension ./extensions/file-explorer
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled, resolveEffectiveCwd } from "../../lib/env.ts";
import { openTarget, resolveTarget, type OpenMode } from "./open.ts";
import { OpenPathOutput, OpenPathParams, TOOL_NAME, type OpenPathArgs, type OpenPathResult } from "./schema.ts";

export interface FileExplorerDeps {
	/** Override the OS launcher (tests). */
	open?: typeof openTarget;
}

export default function fileExplorer(pi: ExtensionAPI, deps: FileExplorerDeps = {}): void {
	if (!isExtensionEnabled("file-explorer")) return;
	const open = deps.open ?? openTarget;

	/**
	 * Resolve `raw` against the effective root and hand it to the native
	 * handler. A launch failure is reported through `ctx.ui.notify` because the
	 * handler runs detached; the target is returned for the caller's message.
	 */
	const launch = (mode: OpenMode, raw: string, ctx: ExtensionContext): string => {
		const root = resolveEffectiveCwd(ctx.cwd);
		const target = resolveTarget(root, raw);
		open(mode, target, {
			onError: (error) => ctx.ui.notify(`Could not open ${target}: ${error.message}`, "error"),
		});
		return target;
	};

	pi.registerTool({
		name: TOOL_NAME,
		label: "Open",
		description:
			"Open a file or directory in the OS-native application, or reveal it in the file manager. " +
			"The path may be relative to the working directory or absolute.",
		promptSnippet: "Open or reveal a path in the OS-native app.",
		promptGuidelines: [
			"Use open_path when the user asks to open or reveal a file or directory in a native application.",
			"Do not use open_path to read file contents; use the read tool for that.",
		],
		parameters: OpenPathParams,
		outputSchema: OpenPathOutput,
		exposure: "codemode",
		// `readOnlyHint: false` even though opening a path writes nothing: the
		// tool launches an external application, and plan mode allows tools by
		// this hint, so opening must stay behind the normal policy.
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as OpenPathArgs;
			const mode: OpenMode = args.reveal ? "reveal" : "open";
			const target = launch(mode, args.path, ctx);
			const result: OpenPathResult = { target, reveal: mode === "reveal" };
			return {
				content: [{ type: "text", text: `${mode === "reveal" ? "Revealed" : "Opened"} ${target}` }],
				details: result,
				structuredContent: result,
			};
		},
	});

	pi.registerCommand("open", {
		description: "Open a file or directory in the native app (/open . or /open -r src)",
		getArgumentCompletions: (prefix) => {
			const text = prefix.trimStart();
			// Only the leading `-r` flag is completed; the path is left to the user.
			if (!text.startsWith("-") || text.includes(" ")) return null;
			const items = ["-r"].filter((option) => option.startsWith(text));
			return items.length > 0 ? items.map((value) => ({ value: `${value} `, label: "reveal in file manager" })) : null;
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const reveal = /^-r\b/.test(trimmed);
			const rest = trimmed.replace(/^-r\b\s*/, "").trim();
			try {
				const target = launch(reveal ? "reveal" : "open", rest, ctx);
				ctx.ui.notify(`${reveal ? "Revealed" : "Opened"} ${target}`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
