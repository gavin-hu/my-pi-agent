/**
 * The `/sessions` command.
 *
 * In the TUI, bare `/sessions` opens the live board: `Tab` cycles Sessions,
 * Inbox, and Claims, and `w`/`x` act on this session's own watch and claims.
 * Every other mode prints the compact listing, because there is no dock to mount
 * the screen in. Neither joins the bus: reading is not joining, so the board is
 * empty until this session joins. `join [<label>]` is the join.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { withPolledScreen } from "../../lib/screen-session.ts";
import { formatJoin, formatStatus } from "./format.ts";
import { COMMAND_NAME } from "./protocol.ts";
import type { SessionBus } from "./runtime.ts";
import { SessionListComponent } from "./tui.ts";

const USAGE = "/sessions [join [<label>]]";

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
async function openSessionsScreen(pi: ExtensionAPI, ctx: ExtensionCommandContext, bus: SessionBus): Promise<void> {
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
						// The board's toggle is the same act as a join, so it says the same thing.
						const joined = await bus.join({ listen: !armed });
						if (holder.screen) await reader(holder.screen);
						return formatJoin(joined.label, joined.watching);
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
			await openSessionsScreen(pi, ctx, bus);
			return;
		}
		await bus.start(ctx);
		ctx.ui.notify(formatStatus(await bus.status()), "info");
	} catch (error) {
		ctx.ui.notify(`Session bus: ${messageOf(error)}`, "warning");
	}
}

export function registerCommands(pi: ExtensionAPI, bus: SessionBus): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "List parallel Pi sessions, their unread counts and claims; join the bus",
		getArgumentCompletions: (prefix) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			const options = ["join", "help"].filter((value) => value.startsWith(text));
			return options.length > 0 ? options.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const [sub = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (sub === "help") {
				ctx.ui.notify(
					`/sessions — open the bus board\n/sessions join [<label>] — join under a label, and listen for mail\n\n${USAGE}`,
					"info",
				);
				return;
			}
			if (sub === "join") {
				const label = rest.join(" ").trim();
				try {
					await bus.start(ctx);
					const joined = await bus.join(label === "" ? {} : { label });
					// The bus validates first, so a rejected label leaves both names alone.
					if (label !== "") pi.setSessionName(joined.label);
					ctx.ui.notify(formatJoin(joined.label, joined.watching), "info");
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
