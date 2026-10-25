/**
 * The page's lifecycle: one server per session, started by `/board` and closed by
 * `/board stop`, by the idle grace once the last tab has been gone for a minute, or by
 * `session_shutdown`.
 *
 * Only the lifecycle lives here — the state machine, the port it remembers, the chip
 * that names it, and the three closes. What the page *reads* is `snapshot.ts`, what it
 * *writes* is `writes.ts`, and how a request reaches either is `transport/`; the router
 * knows nothing of the page's markup, and this is still the one place they meet.
 *
 * All state lives in this closure, not at module scope: Pi loads each extension with an
 * isolated module cache, so a module variable would be one copy per extension.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BoardStore } from "../../lib/board/store.ts";
import { openInBrowser } from "../../lib/browser.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import type { RepeatTimer } from "../../lib/timer.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { viewOf } from "./snapshot.ts";
import { writeOf } from "./writes.ts";
import { type BoardServer, createBoardServer } from "./transport/server.ts";
import { BOARD_CLIENT_JS } from "./view/client.ts";
import { type PageView, renderBoardPage } from "./view/page.ts";

/** A free port in the range the other loopback pages use, so a session's pages cluster. */
export function randomPort(): number {
	return 4780 + Math.floor(Math.random() * 1000);
}

/**
 * How long the page waits for a tab after the last one leaves.
 *
 * Long enough to survive closing the tab to run a command and coming back, short
 * enough that an abandoned page does not answer a port for the rest of the session.
 * `/board` starts it again on the same port.
 */
export const IDLE_STOP_MS = 60_000;

/** What `/board status` prints. */
export interface BoardPageStatus {
	running: boolean;
	port?: number;
	url?: string;
	where?: string;
}

/**
 * What `/board` got when it asked for the page.
 *
 * A result rather than a boolean, because the two ways a start can end are told apart by
 * what the command says next — and because *this session is watching somebody else's
 * page* is a third answer a `running: false` could not express.
 */
export type PageStart =
	| { kind: "served"; port: number; url: string; where: string }
	| { kind: "failed"; reason: string };

/** Test seams and the one place a caller may redirect the browser. */
export interface BoardPageDeps {
	open?: (url: string) => void;
	pickPort?: () => number;
	interval?: RepeatTimer;
	/** Grace after the last tab leaves; defaults to {@link IDLE_STOP_MS}. */
	idleMs?: number;
}

/** The page as `/board` and `session_shutdown` drive it. */
export interface BoardPage {
	start: (ctx: ExtensionContext, view?: PageView) => Promise<PageStart>;
	stop: (ctx: ExtensionContext) => Promise<boolean>;
	status: () => BoardPageStatus;
	closeAll: () => Promise<void>;
}

export function createBoardPage(runtime: BoardSession, deps: BoardPageDeps = {}): BoardPage {
	let running: { server: BoardServer; store: BoardStore } | undefined;
	let sessionPort: number | undefined;

	const storeOf = async (ctx: ExtensionContext): Promise<BoardStore> => runtime.store(ctx.cwd);

	const stop = async (ctx: ExtensionContext): Promise<boolean> => {
		if (!running) return false;
		const { server } = running;
		running = undefined;
		await server.close();
		clearChip(ctx);
		return true;
	};

	const start = async (ctx: ExtensionContext, view: PageView = "board"): Promise<PageStart> => {
		if (running) return describe(running);
		const store = await storeOf(ctx);
		await store.ensure();
		// One actor for every request the page answers, read per call so a session that is
		// renamed is named by its next write rather than by the one that started the page.
		const actor = () => runtime.who(ctx, ctx.cwd);
		const now = () => runtime.now();
		const preferred = sessionPort ?? (deps.pickPort ?? randomPort)();
		let server: BoardServer;
		try {
			server = await createBoardServer({
				ports: [preferred, 0],
				...(deps.interval === undefined ? {} : { interval: deps.interval }),
				idleMs: deps.idleMs ?? IDLE_STOP_MS,
				onIdle: () => void stopIdle(ctx),
				page: async (view) => renderBoardPage({ view }),
				script: BOARD_CLIENT_JS,
				view: () => viewOf({ store, actor, now, busDir: () => runtime.busDir(ctx.cwd) }),
				write: (request) => writeOf({ store, actor, now }, request),
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`board: the page did not start (${reason})`, "error");
			return { kind: "failed", reason };
		}
		sessionPort = server.port;
		running = { server, store };
		setChip(ctx, server.port);
		(deps.open ?? openInBrowser)(view === "board" ? server.url : `${server.url}&view=team`);
		return describe(running);
	};

	/** The idle grace closes the page and says so, once. */
	const stopIdle = async (ctx: ExtensionContext): Promise<void> => {
		if (await stop(ctx)) ctx.ui.notify("board: stopped — the last page was closed", "info");
	};

	const describe = (state: { server: BoardServer; store: BoardStore }): PageStart => ({
		kind: "served",
		port: state.server.port,
		url: state.server.url,
		where: state.store.where(),
	});

	return {
		start,
		stop,
		status: () => (running ? { running: true, ...describe(running) } : { running: false }),
		closeAll: async () => {
			if (!running) return;
			const { server } = running;
			running = undefined;
			await server.close();
		},
	};
}

/** The chip naming the port, cleared with an empty text. */
function setChip(ctx: ExtensionContext, port: number): void {
	try {
		ctx.ui.setStatus(
			STATUS_KEYS.board,
			`${paint(ctx.ui.theme, "ok", GLYPHS.board)} ${paint(ctx.ui.theme, "accent", String(port))}`,
		);
	} catch {
		// A host without a status line is not a reason to keep the page from starting.
	}
}

function clearChip(ctx: ExtensionContext): void {
	try {
		ctx.ui.setStatus(STATUS_KEYS.board, undefined);
	} catch {
		// Same as above: nothing to clear.
	}
}
