/**
 * What a board call works on, and who it writes as.
 *
 * One store per working directory, opened on first use and kept for the session:
 * a tool call is frequent and the repository lookup shells out to git, so the
 * answer is remembered per `cwd`. The identity is the same pair a card records —
 * the session id Pi knows, and the label `session-bus` would settle by default —
 * which is why the board can name its owner without reading the bus.
 *
 * The store and its cache live in this closure, not in a module variable: Pi loads
 * each extension with an isolated module cache, so module state would be one copy
 * per extension and none of them the same one.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultLabel, sessionNameOf } from "../session-label.ts";
import type { Actor } from "./rules.ts";
import { type BoardStore, openBoard } from "./store.ts";

/** What a tool, a page, and a round need from the session, without any of them owning it. */
export interface BoardSession {
	/** The board for `cwd`'s repository. */
	store(cwd: string): Promise<BoardStore>;
	/** The session a write is made as. */
	who(ctx: ExtensionContext, cwd: string): Actor;
	/** The clock, so a test drives a deadline instead of waiting on one. */
	now(): number;
}

/** Test seams and the one place a caller may redirect the store. */
export interface BoardSessionOptions {
	now?: () => number;
	agentDir?: string;
}

/**
 * Build the session around one extension's `pi`.
 *
 * Shared by `board` and `team`: both work on the same store and must name a write
 * as the same session, and two copies are how a card's owner label drifts from the
 * label the board writes.
 */
export function openBoardSession(pi: ExtensionAPI, options: BoardSessionOptions = {}): BoardSession {
	const stores = new Map<string, Promise<BoardStore>>();
	const agentDir = options.agentDir;
	return {
		store(cwd) {
			const cached = stores.get(cwd);
			if (cached) return cached;
			const opened = openBoard(pi, cwd, agentDir === undefined ? {} : { agentDir });
			stores.set(cwd, opened);
			return opened;
		},
		who(ctx, cwd) {
			const id = sessionIdOf(ctx);
			const label = defaultLabel(sessionNameOf(ctx), cwd, id ?? "session");
			return id === undefined ? { label } : { id, label };
		},
		now: options.now ?? Date.now,
	};
}

/** The session id, or undefined when the host does not report one. */
function sessionIdOf(ctx: ExtensionContext): string | undefined {
	try {
		const id = ctx.sessionManager.getSessionId();
		return typeof id === "string" && id !== "" ? id : undefined;
	} catch {
		return undefined;
	}
}
