/**
 * The `/sessions` command.
 *
 * In the TUI, bare `/sessions` opens the live board: `Tab` cycles Sessions,
 * Inbox, and Claims, and `w`/`x` act on this session's own watch and claims.
 * Every other mode prints the compact listing, because there is no dock to mount
 * the screen in. `name <label>` gives this session a stable target and `watch
 * [off|wake]` controls the inbox watch from either surface.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { withPolledScreen } from "../../lib/screen-session.ts";
import { formatStatus, formatWatch } from "./format.ts";
import type { SessionBus } from "./runtime.ts";
import { SessionListComponent } from "./tui.ts";

const USAGE = "/sessions [name <label>|watch [off|wake]]";
const WATCH_MODES = ["off", "wake"];

/** How often the open board re-reads the bus. */
const BOARD_POLL_MS = 1_000;

/**
 * One board read at a time, shared by the open screen's poll and its watch verb.
 *
 * A read that is still running is skipped rather than queued, and a failed read
 * leaves the last board on screen; the bus's own heartbeat keeps this session's
 * record fresh, so a poll never has to write. Both reads are read-only: the
 * snapshot neither prunes nor refreshes, and the peek neither consumes nor marks.
 */
function createBoardReader(bus: SessionBus): (screen: SessionListComponent) => Promise<void> {
	let busy = false;
	return async (screen) => {
		if (busy) return;
		busy = true;
		try {
			const [status, messages] = await Promise.all([bus.snapshot(), bus.peek()]);
			screen.setBoard({ status, messages });
		} catch {
			// Best-effort: the next tick tries again, and the board keeps its last read.
		} finally {
			busy = false;
		}
	};
}

/** Open the TUI board, and resolve when it closes. */
async function openBoard(pi: ExtensionAPI, ctx: ExtensionCommandContext, bus: SessionBus): Promise<void> {
	await bus.start(ctx);
	const [status, messages] = await Promise.all([bus.snapshot(), bus.peek()]);
	const first = { status, messages };
	let read: ((screen: SessionListComponent) => Promise<void>) | undefined;
	await withPolledScreen(
		pi,
		ctx,
		(screen) => {
			const reader = createBoardReader(bus);
			read = reader;
			// The verbs repaint the board they belong to; their callbacks only run after
			// construction, so a holder keeps the wiring one-directional.
			const holder: { screen?: SessionListComponent } = {};
			const component = new SessionListComponent({
				latest: () => first,
				theme: screen.theme,
				callbacks: {
					toggleWatch: async (armed) => {
						const watching = await bus.watch({ stop: armed });
						if (holder.screen) await reader(holder.screen);
						return formatWatch(watching);
					},
					releaseClaim: async (path) => {
						const released = await bus.releaseStored(path);
						if (holder.screen) await reader(holder.screen);
						const name = sanitizeLine(path);
						return released ? `Released ${name}.` : `${name} is no longer yours.`;
					},
				},
				onClose: screen.close,
				requestRender: screen.requestRender,
				viewportRowsSource: screen.viewportRows,
			});
			holder.screen = component;
			return component;
		},
		{ pollMs: BOARD_POLL_MS, poll: (component) => void read?.(component) },
	);
}

async function open(ctx: ExtensionCommandContext, pi: ExtensionAPI, bus: SessionBus): Promise<void> {
	try {
		if (ctx.mode === "tui") {
			await openBoard(pi, ctx, bus);
			return;
		}
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
			const options = ["name", "help", "watch"].filter((value) => value.startsWith(text));
			return options.length > 0 ? options.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const [sub = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (sub === "help") {
				ctx.ui.notify(
					`/sessions — open the bus board\n/sessions name <label> — name this session\n` +
						`/sessions watch [off|wake] — report new mail at the next turn, or raise one\n\n${USAGE}`,
					"info",
				);
				return;
			}
			if (sub === "watch") {
				const mode = rest[0] ?? "";
				if (mode !== "" && !WATCH_MODES.includes(mode)) {
					ctx.ui.notify(`Unknown watch mode "${mode}". Usage: /sessions watch [off|wake]`, "warning");
					return;
				}
				try {
					await bus.start(ctx);
					const status = await bus.status();
					const watching = await bus.watch({ stop: mode === "off", wake: mode === "wake" });
					ctx.ui.notify(formatWatch(watching, status.me.label), "info");
				} catch (error) {
					ctx.ui.notify(`Session bus: ${messageOf(error)}`, "warning");
				}
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
					const renamed = await bus.rename(label);
					// The bus validates first, so a rejected label leaves both names alone.
					pi.setSessionName(renamed);
					ctx.ui.notify(`This session is now named "${renamed}".`, "info");
				} catch (error) {
					ctx.ui.notify(`Session bus: ${messageOf(error)}`, "warning");
				}
				return;
			}
			if (sub !== "") {
				ctx.ui.notify(`Unknown sessions command "${sub}". Try ${USAGE}.`, "warning");
				return;
			}
			await open(ctx, pi, bus);
		},
	});
}
