/**
 * The page's lifecycle: one server per session, started by `/board` and closed by
 * `/board stop`, by the idle grace once the last tab has been gone for a minute, or
 * by `session_shutdown`.
 *
 * The server is built from three things this module owns: the store (through the
 * runtime), the snapshot (`buildView` over the cards it reads), and the write path
 * (the store's `mutate` with the routines' rules, or `create` for a card the page
 * adds). The transport half (`transport/`) knows none of that, and the router knows
 * nothing of the page's markup — this is the one place they meet.
 *
 * All state lives in this closure, not at module scope: Pi loads each extension with
 * an isolated module cache, so a module variable would be one copy per extension.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeCardId, normalizeNote, normalizePathHints, normalizeTitle } from "../../lib/board/card.ts";
import type { CardOp } from "../../lib/board/rules.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import { buildView, type BoardView } from "../../lib/board/view.ts";
import { readRoster } from "../../lib/session-roster.ts";
import { openInBrowser } from "../../lib/browser.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import type { RepeatTimer } from "../../lib/timer.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import type { PageResult, PageWrite } from "./transport/router.ts";
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
	start: (ctx: ExtensionContext, view?: PageView) => Promise<BoardPageStatus>;
	stop: (ctx: ExtensionContext) => Promise<boolean>;
	status: () => BoardPageStatus;
	closeAll: () => Promise<void>;
}

export function createBoardPage(runtime: BoardSession, deps: BoardPageDeps = {}): BoardPage {
	let running: { server: BoardServer; store: BoardStore } | undefined;
	let sessionPort: number | undefined;

	const storeOf = async (ctx: ExtensionContext): Promise<BoardStore> => runtime.store(ctx.cwd);

	/** The snapshot the page renders. */
	const viewOf = async (store: BoardStore, ctx: ExtensionContext): Promise<BoardView> => {
		// The bus's records are read as data, so the page lists teammates when they are
		// there and draws exactly what it drew before when they are not.
		const roster = await readRoster(await runtime.busDir(ctx.cwd));
		return buildView({
			me: runtime.who(ctx, ctx.cwd),
			cards: await store.list(),
			now: runtime.now(),
			bytes: await store.bytes(),
			where: store.where(),
			...(roster === undefined ? {} : { roster }),
		});
	};

	/**
	 * One write from the page, made as the serving session.
	 *
	 * Validation is 422 and a tripped precondition is 409: the page shows both as a
	 * banner, and the difference matters to a client that retries — a bad title never
	 * will work, and a card somebody claimed may.
	 */
	const writeOf = async (store: BoardStore, ctx: ExtensionContext, request: PageWrite): Promise<PageResult> => {
		const me = runtime.who(ctx, ctx.cwd);
		if (request.kind === "add") {
			const title = normalizeTitle(request.body.title);
			if ("error" in title) return { ok: false, status: 422, error: title.error };
			const paths = normalizePathHints(request.body.paths);
			if ("error" in paths) return { ok: false, status: 422, error: paths.error };
			let note: string | undefined;
			if (request.body.note !== undefined) {
				const parsed = normalizeNote(request.body.note);
				if ("error" in parsed) return { ok: false, status: 422, error: parsed.error };
				note = parsed.text;
			}
			const card = await store.create(
				{ title: title.title, paths: paths.paths, ...(note === undefined ? {} : { note }) },
				me,
				runtime.now(),
			);
			return { ok: true, card };
		}

		const id = normalizeCardId(request.id);
		if (id === undefined) return { ok: false, status: 422, error: `"${request.id}" is not a card id.` };
		const op = opOf(request);
		if ("error" in op) return { ok: false, status: 422, error: op.error };
		const result = await store.mutate(id, op.op, me, runtime.now());
		if (!result.ok)
			return {
				ok: false,
				status: 409,
				error: result.error,
				...(result.card === undefined ? {} : { card: result.card }),
			};
		return { ok: true, card: result.card };
	};

	const stop = async (ctx: ExtensionContext): Promise<boolean> => {
		if (!running) return false;
		const { server } = running;
		running = undefined;
		await server.close();
		clearChip(ctx);
		return true;
	};

	const start = async (ctx: ExtensionContext, view: PageView = "board"): Promise<BoardPageStatus> => {
		if (running) return describe(running);
		const store = await storeOf(ctx);
		await store.ensure();
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
				view: () => viewOf(store, ctx),
				write: (request) => writeOf(store, ctx, request),
			});
		} catch (error) {
			ctx.ui.notify(
				`board: the page did not start (${error instanceof Error ? error.message : String(error)})`,
				"error",
			);
			return { running: false };
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

	const describe = (state: { server: BoardServer; store: BoardStore }): BoardPageStatus => ({
		running: true,
		port: state.server.port,
		url: state.server.url,
		where: state.store.where(),
	});

	return {
		start,
		stop,
		status: () => (running ? describe(running) : { running: false }),
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

/** The operation a card route names, or the reason it cannot be one. */
function opOf(request: PageWrite): { op: CardOp } | { error: string } {
	switch (request.kind) {
		case "claim":
			return { op: { kind: "claim" } };
		case "release":
			return { op: { kind: "release" } };
		case "reclaim":
			return { op: { kind: "reclaim" } };
		case "drop":
			return { op: { kind: "drop" } };
		case "note":
			return { op: { kind: "note", text: request.body.text } };
		case "plan":
			return { op: { kind: "plan", path: request.body.path } };
		case "move": {
			const status = request.body.status;
			if (status === "doing" || status === "blocked" || status === "done") return { op: { kind: "move", status } };
			return { error: 'move needs a target lane: "doing", "blocked", or "done".' };
		}
		default:
			return { error: "add is not a card route." };
	}
}
