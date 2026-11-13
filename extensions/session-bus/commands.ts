/**
 * The `/sessions` command: the board, and the one verb that is not the board.
 *
 * In the TUI it opens the live board: `Tab` cycles Sessions, Inbox, and Claims,
 * and `w`/`x` act on this session's own watch and claims. Every other mode prints
 * the compact listing, because there is no dock to mount the screen in. Reading is
 * not joining, so the board is empty until this session joins — and a command
 * context cannot name a session, so the join is `session({action:"join"})`,
 * `/team join [<label>]`, or the board's `w`.
 *
 * `drop` is the exception, and it is a command because of what it destroys: mail no record holds
 * is evidence, so a person clears it and no session's tool call can. A bare `/sessions drop`
 * drops nothing and prints the mail a drop could name — the board draws no row for it, so this is
 * also the only way to see it in a terminal.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { formatDrop, formatJoin, formatStatus, formatUnaccounted } from "./format.ts";
import { COMMAND_NAME } from "./protocol.ts";
import type { SessionBus } from "./runtime.ts";

/** How often the open board re-reads the bus. */
const BOARD_POLL_MS = 1_000;

/** The one word `/sessions` takes besides opening the board. */
export const SESSION_WORDS = ["drop"] as const;

/**
 * One board read at a time, shared by the open screen's poll and its watch verb.
 *
 * A read that is still running is skipped rather than queued, and a failed read
 * leaves the last board on screen; the bus's own heartbeat keeps this session's
 * record fresh, so a poll never has to write. Both reads are read-only: the
 * snapshot neither prunes nor refreshes, and the peek neither consumes nor marks.
 */
function createBoardReader(bus: SessionBus): (screen: SessionsScreen) => Promise<void> {
	let busy = false;
	return async (screen) => {
		if (busy) return;
		busy = true;
		try {
			const [status, peeked] = await Promise.all([bus.snapshot(), bus.peek()]);
			screen.setBoard({ status, messages: peeked.mail });
		} catch {
			// Best-effort: the next tick tries again, and the board keeps its last read.
		} finally {
			busy = false;
		}
	};
}

/** The mounted board's type, without loading the screen at registration. */
type SessionsScreen = InstanceType<typeof import("./view/session-list.ts")["SessionListComponent"]>;

/** Open the TUI board, and resolve when it closes. */
async function openSessionsScreen(pi: ExtensionAPI, ctx: ExtensionCommandContext, bus: SessionBus): Promise<void> {
	// The board is the TUI's: the text paths below and registration load neither it
	// nor the dock screen's poll loop.
	const { withPolledScreen } = await import("../../lib/screen-session.ts");
	const { SessionListComponent } = await import("./view/session-list.ts");
	await bus.start(ctx);
	const [status, peeked] = await Promise.all([bus.snapshot(), bus.peek()]);
	const first = { status, messages: peeked.mail };
	let read: ((screen: SessionsScreen) => Promise<void>) | undefined;
	await withPolledScreen(
		pi,
		ctx,
		(screen) => {
			const reader = createBoardReader(bus);
			read = reader;
			// The verbs repaint the board they belong to; their callbacks only run after
			// construction, so a holder keeps the wiring one-directional.
			const holder: { screen?: SessionsScreen } = {};
			const component = new SessionListComponent({
				board: first,
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
		ctx.ui.notify(formatStatus(await bus.status(), Date.now()), "info");
	} catch (error) {
		ctx.ui.notify(`Session bus: ${messageOf(error)}`, "warning");
	}
}

/**
 * `/sessions drop [<id>…]`: the mail no record holds, or the ids a person means to clear.
 *
 * No ids is the safe reading of a bare verb — it drops nothing and prints what could be dropped —
 * and it is how this mail is seen at all, because the board has no row for it. The store decides
 * what a drop may touch, refusing any id a record's inbox still holds, so the answer names both
 * what went and what stayed.
 */
async function dropUnaccounted(ctx: ExtensionCommandContext, bus: SessionBus, ids: readonly string[]): Promise<void> {
	try {
		await bus.start(ctx);
		if (ids.length === 0) {
			const status = await bus.status();
			ctx.ui.notify(formatUnaccounted(status.unaccounted ?? [], Date.now()), "info");
			return;
		}
		const result = await bus.dropUnaccounted(ids);
		ctx.ui.notify(formatDrop(result), result.kept.length > 0 ? "warning" : "info");
	} catch (error) {
		ctx.ui.notify(`Session bus: ${messageOf(error)}`, "warning");
	}
}

export function registerCommands(pi: ExtensionAPI, bus: SessionBus): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Open the bus board: sessions, unread mail, and path claims; `drop <id>…` clears mail no record holds",
		// The first word selects the one verb; anything else still opens what it opened before, because
		// a reader who typed a stray word asked for the board and not for a warning about it.
		handler: async (args, ctx) => {
			const [word, ...ids] = args.trim().split(/\s+/).filter(Boolean);
			if (word === "drop") {
				await dropUnaccounted(ctx, bus, ids);
				return;
			}
			await open(ctx, pi, bus);
		},
	});
}
