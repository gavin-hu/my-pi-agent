/**
 * prompt — refine a submitted prompt before the agent acts on it.
 *
 * On every eligible submit the clarifier is asked whether the request is clear.
 * When it is not, the user answers a few structured questions through Pi's
 * dialogs, and the agent receives the original wording plus the confirmed goal
 * and the answers. The clarifier's own tokens are not counted in the session
 * totals (see the README).
 *
 * Load with:  pi --extension ./extensions/prompt
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { recentTurnText } from "./clarifier.ts";
import { registerCommands } from "./commands.ts";
import { loadPromptConfig } from "./config.ts";
import { askQuestions, confirmRequest, withLoader } from "./dialogs.ts";
import { createCompleter, refinePrompt, shouldRefine } from "./refine.ts";
import { createPromptRuntime } from "./runtime.ts";

export default function prompt(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("prompt")) return;
	const runtime = createPromptRuntime();

	registerCommands(pi, runtime);

	pi.on("session_start", (_event, ctx) => runtime.setConfig(loadPromptConfig(ctx.cwd ?? process.cwd())));
	pi.on("session_shutdown", () => runtime.end());

	pi.on("input", async (event, ctx) => {
		const config = runtime.getConfig();
		const eligible = shouldRefine({
			enabled: runtime.isEnabled(),
			hasUI: ctx.hasUI,
			hasModel: ctx.model !== undefined,
			isIdle: ctx.isIdle(),
			source: event.source,
			streaming: event.streamingBehavior !== undefined,
			text: event.text,
			minLength: config.minLength,
			busy: runtime.isBusy(),
		});
		if (!eligible) return { action: "continue" };

		if (!runtime.begin()) return { action: "continue" };
		try {
			const history = recentTurnText(ctx.sessionManager.getBranch(), config.contextMessages);
			const complete = createCompleter(ctx, config.timeoutMs, (run) => withLoader(ctx, "Clarifying prompt…", run));
			const outcome = await refinePrompt({
				text: event.text,
				config,
				history,
				deps: {
					complete,
					ask: (questions) => askQuestions(ctx.ui, questions),
					confirm: (goal, answers) => confirmRequest(ctx.ui, goal, answers),
				},
			});
			if (outcome.action === "transform") {
				return { action: "transform", text: outcome.text, images: event.images };
			}
			return { action: "continue" };
		} catch {
			return { action: "continue" };
		} finally {
			runtime.end();
		}
	});
}
