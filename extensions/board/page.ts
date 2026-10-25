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
import {
	clearPointer,
	PAGE_FILE,
	type PagePointer,
	type ProbeFetch,
	probePage,
	readPointer,
	settlePointer,
	urlOf,
} from "../../lib/board/page-pointer.ts";
import { mintToken } from "../../lib/http/index.ts";
import { join } from "node:path";
import { type BoardConfig, loadBoardConfig } from "./config.ts";
import { pageActor } from "./seat.ts";
import { viewOf } from "./snapshot.ts";
import { type BoardServer, createBoardServer } from "./transport/server.ts";
import { BOARD_CLIENT_JS } from "./view/client.ts";
import { type PageView, renderBoardPage } from "./view/page.ts";

/**
 * A free port in the range the other loopback pages use, so a session's pages cluster.
 * Only the unpinned page draws one: `board.port` in `bytefly.json` states the port a
 * bookmarked URL keeps.
 */
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
	/** True when this session opened somebody else's page instead of serving one. */
	attached?: boolean;
	/** The name the page serves as: a seat, not the session that opened it. */
	seat?: string;
	port?: number;
	url?: string;
	where?: string;
	/** How many tabs are attached, while this session serves the page. */
	watchers?: number;
}

/**
 * What `/board` got when it asked for the page.
 *
 * A result rather than a boolean, because the two ways a start can end are told apart by
 * what the command says next — and because *this session is watching somebody else's
 * page* is a third answer a `running: false` could not express.
 */
export type PageStart =
	| { kind: "served"; seat: string; port: number; url: string; where: string }
	| { kind: "attached"; seat: string; port: number; url: string; where: string }
	| { kind: "failed"; reason: string };

/** Test seams and the one place a caller may redirect the browser. */
export interface BoardPageDeps {
	open?: (url: string) => void;
	pickPort?: () => number;
	interval?: RepeatTimer;
	/** Grace after the last tab leaves; defaults to {@link IDLE_STOP_MS}. */
	idleMs?: number;
	/** Whether a page another session left a note about is answering; a test drives it. */
	probe?: ProbeFetch;
	/** How the `board` section answers; a test drives it without a config file. */
	config?: (cwd: string) => BoardConfig;
}

/** The page as `/board` and `session_shutdown` drive it. */
export interface BoardPage {
	start: (ctx: ExtensionContext, view?: PageView) => Promise<PageStart>;
	stop: (ctx: ExtensionContext) => Promise<boolean>;
	status: () => BoardPageStatus;
	closeAll: () => Promise<void>;
}

export function createBoardPage(runtime: BoardSession, deps: BoardPageDeps = {}): BoardPage {
	let running: { server: BoardServer; store: BoardStore; token: string } | undefined;
	/** The page another session serves, when this session opened that one instead. */
	let attachedTo: PagePointer | undefined;
	let sessionPort: number | undefined;
	// The page is a seat, not a session: one name and one id for its whole life, so a card
	// a browser claimed is still the seat's after the session that served it ends.
	const seat = pageActor();

	const storeOf = async (ctx: ExtensionContext): Promise<BoardStore> => runtime.store(ctx.cwd);

	const stop = async (ctx: ExtensionContext): Promise<boolean> => {
		if (!running) return false;
		const { server, store, token } = running;
		running = undefined;
		await server.close();
		// The note is the page's, so it leaves with it: a session that reads a note nobody
		// answers wastes a probe, and the next `/board` would attach to a dead port.
		await clearPointer(store.dir, token);
		clearChip(ctx);
		return true;
	};

	const start = async (ctx: ExtensionContext, view: PageView = "board"): Promise<PageStart> => {
		if (running) return describe(running);
		const store = await storeOf(ctx);
		await store.ensure();
		const open = (url: string) => (deps.open ?? openInBrowser)(view === "board" ? url : `${url}&view=team`);
		/** Watch the page another session serves: its note is the URL, its seat the name. */
		const attach = (pointer: PagePointer): PageStart => {
			attachedTo = pointer;
			open(urlOf(pointer));
			return {
				kind: "attached",
				seat: pointer.seat.label,
				port: pointer.port,
				url: urlOf(pointer),
				where: store.where(),
			};
		};
		// Somebody may already serve this repository: a note beside the cards says so, and
		// only the page answering it is one to attach to.
		const existing = await readPointer(store.dir);
		if (existing !== undefined && (await probePage(existing, deps.probe))) return attach(existing);
		attachedTo = undefined;
		const actor = () => seat;
		const now = () => runtime.now();
		// Read on every start, so an edit to the section applies to the next `/board`.
		const config = (deps.config ?? loadBoardConfig)(ctx.cwd);
		const pinned = config.port > 0 ? config.port : undefined;
		const preferred = pinned ?? sessionPort ?? (deps.pickPort ?? randomPort)();
		// The token is minted here rather than by the server, because the note this session
		// leaves has to carry it: that is what a second session reads to attach.
		// Minted here rather than by the server: the note this session leaves has to carry it,
		// and that is what a second session reads to attach instead of serving its own page.
		const token = mintToken();
		let server: BoardServer;
		try {
			server = await createBoardServer({
				// A pinned port is tried alone: falling back would leave the bookmark pointing
				// at a page that moved, which is the failure the setting exists to prevent.
				ports: pinned === undefined ? [preferred, 0] : [pinned],
				token,
				...(deps.interval === undefined ? {} : { interval: deps.interval }),
				idleMs: deps.idleMs ?? IDLE_STOP_MS,
				onIdle: () => void stopIdle(ctx),
				page: async (view) => renderBoardPage({ view }),
				script: BOARD_CLIENT_JS,
				view: () =>
					viewOf({
						store,
						actor,
						session: () => runtime.who(ctx, ctx.cwd),
						now,
						busDir: () => runtime.busDir(ctx.cwd),
					}),
			});
		} catch (error) {
			const reason = failureReason(error, pinned);
			ctx.ui.notify(`board: the page did not start (${reason})`, "error");
			return { kind: "failed", reason };
		}
		// The note is written last, on the port the server actually bound, and only if no
		// other session got there first: the loser of that race attaches to the page that
		// won rather than serving a second page nobody can find. A note that answers
		// nobody is taken over, so a page that died between its note and its server does not
		// hold the name forever, and a note this build cannot read is named rather than
		// blamed on a session that does not exist.
		const note: PagePointer = {
			port: server.port,
			token,
			seat: { id: seat.id, label: seat.label },
			startedAt: runtime.now(),
		};
		const outcome = await settlePointer(store.dir, note, deps.probe);
		if (outcome.kind === "attached") {
			await server.close();
			return attach(outcome.pointer);
		}
		if (outcome.kind === "written" && outcome.took !== undefined) {
			const dead = outcome.took;
			ctx.ui.notify(
				`board: ${dead.seat.label} on :${dead.port} does not answer — open ${urlOf(dead)} · took its note over`,
				"info",
			);
		}
		if (outcome.kind !== "written") {
			await server.close();
			const path = join(store.dir, PAGE_FILE);
			const reason =
				outcome.kind === "stale"
					? `${path} names ${outcome.pointer.seat.label} on :${outcome.pointer.port}, and nothing answers — remove it to serve this board`
					: outcome.kind === "busy"
						? `${path} kept changing hands — run /board again`
						: `${path} is there and cannot be read — remove it to serve this board`;
			ctx.ui.notify(`board: the page did not start (${reason})`, "error");
			return { kind: "failed", reason };
		}
		sessionPort = server.port;
		running = { server, store, token };
		setChip(ctx, server.port);
		open(server.url);
		return describe(running);
	};

	/** The idle grace closes the page and says so, once. */
	const stopIdle = async (ctx: ExtensionContext): Promise<void> => {
		if (await stop(ctx)) ctx.ui.notify("board: stopped — the last page was closed", "info");
	};

	const describe = (state: { server: BoardServer; store: BoardStore }): PageStart => ({
		kind: "served",
		seat: seat.label,
		port: state.server.port,
		url: state.server.url,
		where: state.store.where(),
	});

	/** What `/board status` answers, wherever the page is: served here, watched, or absent. */
	const statusOf = (): BoardPageStatus => {
		if (running) {
			return {
				running: true,
				seat: seat.label,
				port: running.server.port,
				url: running.server.url,
				where: running.store.where(),
				watchers: running.server.watchers(),
			};
		}
		if (attachedTo !== undefined) {
			return {
				running: false,
				attached: true,
				seat: attachedTo.seat.label,
				port: attachedTo.port,
				url: urlOf(attachedTo),
			};
		}
		return { running: false };
	};

	return {
		start,
		stop,
		status: statusOf,
		closeAll: async () => {
			if (!running) return;
			const { server } = running;
			running = undefined;
			await server.close();
		},
	};
}

/**
 * Why a start failed, naming the setting when the pinned port was the reason: a
 * bind error's own text says the address, not the key that chose it.
 */
function failureReason(error: unknown, pinned: number | undefined): string {
	// The bind path rejects with the `listen` error, so `code` is there to read.
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (pinned !== undefined && code === "EADDRINUSE") {
		return `port ${pinned} is in use — change "port" in the bytefly.json board section, or stop what answers on it`;
	}
	return error instanceof Error ? error.message : String(error);
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
