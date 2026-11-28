/**
 * The page's lifecycle: one mount per session, started by `/board` and given back by
 * `/board exit`, by the idle grace once the last tab has been gone for a minute, or by
 * `session_shutdown`.
 *
 * Only the lifecycle lives here — the state machine, the prefix it holds, the note that
 * names it, and the three closes. The session's port belongs to `serve`, so nothing here
 * picks one. What the page *reads* is `snapshot.ts`, and it writes nothing: how a request
 * reaches the snapshot is `transport/`, the router knows nothing of the page's markup, and
 * this is still the one place they meet.
 *
 * All state lives in this closure, not at module scope: Pi loads each extension with an
 * isolated module cache, so a module variable would be one copy per extension.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type BoardStore, CARDS_DIR_NAME } from "../../lib/workflow/store.ts";
import { type Launch, openPageInBrowser, urlLauncher } from "../../lib/browser.ts";
import { isRemoteTurn } from "../../lib/interaction.ts";
import type { ArmTimer, RepeatTimer } from "../../lib/timer.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";
import {
	BOARD_BASE,
	clearPointer,
	PAGE_FILE,
	type PagePointer,
	type ProbeFetch,
	probePage,
	readPointer,
	settlePointer,
	urlOf,
} from "../../lib/workflow/page-pointer.ts";
import { mintToken, type MountSource } from "../../lib/http/index.ts";
import { messageOf } from "../../lib/errors.ts";
import type { IdleReason } from "../../lib/http/sink.ts";
import { join } from "node:path";
import type { Actor } from "../../lib/workflow/rules.ts";
import { pageActor } from "../../lib/workflow/seat.ts";
import { createSnapshot, stampBus } from "./snapshot.ts";
import { type BoardServer, createBoardServer } from "./transport/server.ts";
import { BOARD_CLIENT_JS } from "./view/client.ts";
import { type PageView, renderBoardPage } from "./view/page.ts";

/**
 * How long the page waits for a tab after the last one leaves.
 *
 * Long enough to survive closing the tab to run a command and coming back, short
 * enough that an abandoned page does not answer a port for the rest of the session.
 * `/board` starts it again on the same port.
 */
export const IDLE_STOP_MS = 60_000;

/**
 * How long a page may stand with no tab ever attached.
 *
 * `/board` opens a browser, and a browser that does not open (a swallowed failure, a
 * terminal on a machine with no default browser) would otherwise leave the port bound for
 * the rest of the session. Two minutes is long enough for a person to finish reading the
 * transcript and click the link `/board` printed.
 */
export const IDLE_FIRST_MS = 120_000;

/** What `/board status` prints. */
export interface BoardPageStatus {
	running: boolean;
	/** True when this session opened somebody else's page instead of serving one. */
	attached?: boolean;
	/**
	 * True when that page no longer answers: the note is there, the process behind it is
	 * not, and `/board exit` may drop it.
	 */
	stale?: boolean;
	/** The name the page serves as: a seat, not the session that opened it. */
	seat?: string;
	port?: number;
	url?: string;
	/** The repository's name, so `status` says which board the page is. */
	repo?: string;
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
	| { kind: "served"; seat: string; port: number; url: string; repo: string; where: string }
	| { kind: "attached"; seat: string; port: number; url: string; repo: string; where: string }
	| { kind: "failed"; reason: string };

/** Test seams and the one place a caller may redirect the browser. */
export interface BoardPageDeps {
	/** Record the tab the page asked for, instead of launching one (tests). */
	open?: (url: string) => void;
	/** Drive the launcher to a failure, so a case sees the notice (tests). */
	launch?: Launch;
	/** Where the prefix comes from: the session's server, or a suite's own. */
	mount: MountSource;
	/** The Pi session this page serves as, so the prefix lands on its socket. */
	session: () => string;
	interval?: RepeatTimer;
	/** Grace after the last tab leaves; defaults to {@link IDLE_STOP_MS}. */
	idleMs?: number;
	/** Grace for a page no tab ever attached to; defaults to {@link IDLE_FIRST_MS}. */
	firstIdleMs?: number;
	/**
	 * The one-shot seam the idle grace is armed on, so a test fires the grace instead of
	 * waiting a real minute for it. Product default when absent.
	 */
	timer?: ArmTimer;
	/** Whether a page another session left a note about is answering; a test drives it. */
	probe?: ProbeFetch;
}

/**
 * What `/board exit` got when it went to drop a note nobody answers.
 *
 * An answer rather than a boolean, because the two ways it can end without dropping anything
 * are said differently: a page that came back is somebody's to stop, and a note that is
 * already gone is nothing left to do — calling that one "answering" is how a stale note
 * survived the `/board exit` that had just proved it dead. `gone` is also "this session
 * watches nothing", which `/board exit` never reaches: `stale` is what sends it here.
 */
export type StaleDrop = "dropped" | "live" | "gone";

/** The page as `/board` and `session_shutdown` drive it. */
export interface BoardPage {
	start: (ctx: ExtensionContext, view?: PageView) => Promise<PageStart>;
	/** Give the prefix back; the session's server closes with its last mount. */
	stop: () => Promise<boolean>;
	/** What `/board status` prints: served here, watched, watched and dead, or absent. */
	status: () => Promise<BoardPageStatus>;
	/** Drop the note of a page that has stopped answering; `live` when it answers again. */
	dropStale: (ctx: ExtensionContext) => Promise<StaleDrop>;
	closeAll: () => Promise<void>;
}

export function createBoardPage(runtime: BoardSession, deps: BoardPageDeps): BoardPage {
	let running: { server: BoardServer; store: BoardStore; token: string; seat: Actor } | undefined;
	/** The page another session serves, when this session opened that one instead. */
	let attachedTo: PagePointer | undefined;
	const storeOf = async (ctx: ExtensionContext): Promise<BoardStore> => runtime.store(ctx.cwd);

	/**
	 * Close the page this session serves, and take its note with it.
	 *
	 * One close for both callers: `/board exit` has a context and clears the status line, and
	 * a clean `session_shutdown` has none. The note must leave either way — a note nobody
	 * answers makes every open tab reconnect forever and costs the next `/board` a probe
	 * and a takeover before it serves.
	 */
	const closeRunning = async (): Promise<boolean> => {
		if (running === undefined) return false;
		const { server, store, token } = running;
		running = undefined;
		await server.close();
		await clearPointer(store.dir, token);
		// A page that closed is no seat: the session's next card is written as itself. This is
		// the one place all three closes pass — `/board exit`, the idle grace, and shutdown — so
		// a page nobody is looking at cannot leave the session serving in name only.
		runtime.serve(undefined);
		return true;
	};

	const stop = (): Promise<boolean> => closeRunning();

	const start = async (ctx: ExtensionContext, view: PageView = "board"): Promise<PageStart> => {
		// The tab's switch is `serve`'s and is read once per start, from the directory `serve`
		// reads its port from — so a project document states both, and a worktree session keeps
		// reading the checkout's. Loaded here rather than at registration: a session that never
		// summons the page pays nothing for it.
		const { loadServeConfig } = await import("../../lib/serve-config.ts");
		const { autoOpen } = loadServeConfig(ctx.cwd);
		/**
		 * Put the page in front of the person, or say why the page is only a URL.
		 *
		 * The address is on the command's own line either way; this adds the one fact that line
		 * cannot carry — that the tab did not come, and why.
		 */
		const openPage = (url: string): void => {
			const target = view === "board" ? url : `${url}&view=team`;
			const launch = deps.open === undefined ? deps.launch : urlLauncher(deps.open);
			const outcome = openPageInBrowser(target, {
				autoOpen,
				remote: isRemoteTurn(ctx),
				...(launch === undefined ? {} : { launch }),
				onFailure: (reason) =>
					ctx.ui.notify(`board: could not open the browser (${reason}) — open ${target}`, "warning"),
			});
			if (outcome === "skipped-remote")
				ctx.ui.notify(`board: the browser needs the local machine — open ${target}`, "info");
		};
		// `/board` is how the page is summoned, and a page whose tab was closed is one
		// command away from being shown again — the same answer a viewer's `/board` gives.
		if (running !== undefined) {
			openPage(running.server.url);
			return describe(running);
		}
		/** One refusal for every way a start can fail, named by what failed. */
		const failed = (error: unknown): PageStart => {
			const reason = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`board: the page did not start (${reason})`, "error");
			return { kind: "failed", reason };
		};
		// The board's own directory, then the page: both can fail on a path that exists and
		// cannot be written, and a start that fails must leave no listener behind.
		let store: BoardStore;
		try {
			store = await storeOf(ctx);
			await store.ensure();
		} catch (error) {
			return failed(error);
		}
		// The page is a seat, not a session: one name and one id for its whole life, so a card a
		// browser claimed is still the seat's after the session that served it ends. That name is
		// the board's lead, so serving the page is what makes a session the lead — a repository
		// that names one gets a page served under that name, and the gate accepts it. A project
		// that names no lead has no name to serve as, so the start is refused before a listener
		// exists rather than seating the page as nobody.
		const lead = store.config().lead;
		if (lead === "") return failed(new Error("no lead is named — set `team.lead` in bytefly.json, then `/board`"));
		const seat = pageActor(lead);
		/** Watch the page another session serves: its note is the URL, its seat the name. */
		const attach = (pointer: PagePointer): PageStart => {
			attachedTo = pointer;
			openPage(urlOf(pointer));
			return {
				kind: "attached",
				seat: pointer.seat.label,
				port: pointer.port,
				url: urlOf(pointer),
				repo: store.name(),
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
		// Minted here rather than by the server: the note this session leaves has to carry it,
		// and that is what a second session reads to attach instead of serving its own page.
		const token = mintToken();
		/** Whether this page has already said it cannot read the board. */
		let blind = false;
		// A frame the page cannot build is a dropped frame, not a crash: the ticker asks again
		// in a second. Said once, because a failure that persists would otherwise become one
		// notice per tick — and unsaid, a page that stopped following the board looks frozen.
		const warnBlind = (error: unknown): void => {
			if (blind) return;
			blind = true;
			ctx.ui.notify(`board: the page cannot read the board (${messageOf(error)}) — it will keep trying`, "warning");
		};
		try {
			// One snapshot for this page's life: the watch pushes on every event, so the pile it holds is
			// read again only when `cards/` moved, and the cache goes with the page.
			const snapshot = createSnapshot({
				store,
				actor,
				now,
				bus: () => runtime.bus(ctx.cwd),
				host: () => runtime.host(),
				planDir: () => runtime.planDir(ctx.cwd),
			});
			const started = await createBoardServer({
				mount: deps.mount,
				session: deps.session(),
				token,
				// One watched pile: a card is a file here, and the archive, the roster, and the plan
				// stats are the sweep's — the page draws cards, so the cards' directory is the news.
				dirs: [join(store.dir, CARDS_DIR_NAME)],
				// The bus is the frame's other half and no watch announces it, so the tick asks its
				// cheap question: the mailbox walk happens only when a stamp moved.
				stamp: () => runtime.busDir(ctx.cwd).then(stampBus),
				...(deps.interval === undefined ? {} : { interval: deps.interval }),
				...(deps.timer === undefined ? {} : { timer: deps.timer }),
				onError: warnBlind,
				idleMs: deps.idleMs ?? IDLE_STOP_MS,
				firstIdleMs: deps.firstIdleMs ?? IDLE_FIRST_MS,
				onIdle: (reason) => void stopIdle(ctx, reason),
				page: async (view) =>
					renderBoardPage({ view, base: BOARD_BASE, repo: store.name(), root: store.root(), where: store.where() }),
				script: BOARD_CLIENT_JS,
				view: () => snapshot.view(),
			});
			if (started.kind === "refused") {
				ctx.ui.notify(`board: the page did not start (${started.reason})`, "error");
				return { kind: "failed", reason: started.reason };
			}
			const server = started.server;
			// The mount exists from here, and `running` is the only handle the three closes take: a
			// throw between the mount and the note — `settlePointer` writes beside the cards — would
			// otherwise leave /board mounted, its port bound and its ticker pushing for the rest of
			// the session, with every later `/board` refused as already served.
			const page = { server, store, token, seat };
			running = page;
			// The note and the seat: written last, on the port the server actually bound, and only if no
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
				// This session serves nothing after all: the close is the one every door uses, and its
				// note clear is a no-op for a note this call never wrote.
				await closeRunning();
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
				await closeRunning();
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
			openPage(server.url);
			return describe(page);
		} catch (error) {
			// Nothing to close when the store or the mount failed; the page itself when the note did,
			// so the prefix is free and the seat is nobody's for the next `/board`.
			await closeRunning();
			return failed(error);
		}
	};

	/** The idle grace closes the page and says which grace it was, once. */
	const stopIdle = async (ctx: ExtensionContext, reason: IdleReason): Promise<void> => {
		if (!(await stop())) return;
		ctx.ui.notify(
			reason === "first"
				? "board: stopped — no tab ever opened; /board starts it again"
				: "board: stopped — the last page was closed",
			"info",
		);
	};

	const describe = (state: { server: BoardServer; store: BoardStore; seat: Actor }): PageStart => ({
		kind: "served",
		seat: state.seat.label,
		port: state.server.port,
		url: state.server.url,
		repo: state.store.name(),
		where: state.store.where(),
	});

	/**
	 * What `/board status` answers, wherever the page is: served here, watched, watched and
	 * dead, or absent.
	 *
	 * A watched page is probed, because the note saying it exists is not the same thing as
	 * it answering: after the lead's session ends, its note stays and the reader would
	 * otherwise be told about a port nobody holds.
	 */
	const statusOf = async (): Promise<BoardPageStatus> => {
		if (running !== undefined) {
			return {
				running: true,
				seat: running.seat.label,
				port: running.server.port,
				url: running.server.url,
				repo: running.store.name(),
				where: running.store.where(),
				watchers: running.server.watchers(),
			};
		}
		if (attachedTo === undefined) return { running: false };
		const answers = await probePage(attachedTo, deps.probe);
		return {
			running: false,
			attached: true,
			...(answers ? {} : { stale: true }),
			seat: attachedTo.seat.label,
			port: attachedTo.port,
			url: urlOf(attachedTo),
		};
	};

	/**
	 * Drop the note of a page that has stopped answering.
	 *
	 * Only a note this session watched, and only while it answers nobody: a page that came
	 * back between the status line and this call keeps its note, and `clearPointer`'s token
	 * check makes that true even if a new page wrote one in between. Either way this session
	 * stops watching what it was: a note already removed by its owner, or replaced by a newer
	 * one, is not one this session can clear, and holding the reference to it is what kept
	 * `/board status` calling a gone note stale and `/board exit` calling its page alive.
	 */
	const dropStale = async (ctx: ExtensionContext): Promise<StaleDrop> => {
		const pointer = attachedTo;
		if (pointer === undefined) return "gone";
		if (await probePage(pointer, deps.probe)) return "live";
		const store = await storeOf(ctx);
		const dropped = await clearPointer(store.dir, pointer.token);
		attachedTo = undefined;
		return dropped ? "dropped" : "gone";
	};

	return {
		start,
		stop,
		status: statusOf,
		dropStale,
		closeAll: async () => {
			await closeRunning();
		},
	};
}
