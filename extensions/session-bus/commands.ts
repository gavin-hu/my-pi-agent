/**
 * The `/sessions` command.
 *
 * Bare lists the bus and joins a non-TUI caller; `name <label>` gives this
 * session a stable target. There is no screen: the bus is a compact listing.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import { formatStatus } from "./format.ts";
import type { SessionBus } from "./runtime.ts";

const USAGE = "/sessions [name <label>]";

async function open(ctx: ExtensionCommandContext, bus: SessionBus): Promise<void> {
	try {
		await bus.start(ctx);
		ctx.ui.notify(formatStatus(await bus.status()), "info");
	} catch (error) {
		ctx.ui.notify(`Session bus: ${messageOf(error)}`, "warning");
	}
}

export function registerCommands(pi: ExtensionAPI, bus: SessionBus): void {
	pi.registerCommand("sessions", {
		description: "List parallel Pi sessions, their unread counts and claims; name this session",
		getArgumentCompletions: (prefix) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			const options = ["name", "help"].filter((value) => value.startsWith(text));
			return options.length > 0 ? options.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const [sub = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (sub === "help") {
				ctx.ui.notify(`/sessions — list the bus\n/sessions name <label> — name this session\n\n${USAGE}`, "info");
				return;
			}
			if (sub === "name") {
				const label = rest.join(" ").trim();
				if (!label) {
					ctx.ui.notify("Usage: /sessions name <label>", "warning");
					return;
				}
				try {
					await bus.start(ctx);
					await bus.status();
					ctx.ui.notify(`This session is now named "${await bus.rename(label)}".`, "info");
				} catch (error) {
					ctx.ui.notify(`Session bus: ${messageOf(error)}`, "warning");
				}
				return;
			}
			if (sub !== "") {
				ctx.ui.notify(`Unknown sessions command "${sub}". Try ${USAGE}.`, "warning");
				return;
			}
			await open(ctx, bus);
		},
	});
}
