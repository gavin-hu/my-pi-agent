/**
 * The `/sessions` board: a docked list over the bus, with three scopes.
 *
 * `Tab` cycles Sessions → Inbox → Claims. Sessions and claims come from the bus
 * snapshot, mail from a read-only peek, so the board announces nothing and
 * consumes nothing. The rows, summaries, and focus blocks are in `rows.ts`; this
 * module owns the screen, the scope it shows, and the two verbs that change this
 * session's own state.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Key } from "@earendil-works/pi-tui";
import { messageOf } from "../../lib/errors.ts";
import { formatDuration, sanitizeLine } from "../../lib/format.ts";
import type { ScreenHint, ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { type DetailContents, DockListScreen } from "../../lib/tui/dock-screen.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { keyValueRow } from "../../lib/tui/rows.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { idSuffix } from "./format.ts";
import {
	type SessionRow,
	claimRowLine,
	count,
	messageRowLine,
	sessionDetailBlock,
	sessionRowLine,
	sessionRows,
	summaryCells,
} from "./rows.ts";
import type { BoardSnapshot, BusMessage, ClaimRecord } from "./types.ts";

/** The scopes `Tab` cycles through. */
export type BoardScope = "sessions" | "inbox" | "claims";

/** One row of the board, whichever scope is showing. */
type BoardRow =
	| { kind: "session"; row: SessionRow }
	| { kind: "message"; message: BusMessage }
	| { kind: "claim"; claim: ClaimRecord };

const SCOPE_ORDER: readonly BoardScope[] = ["sessions", "inbox", "claims"];

const SCOPE_TITLE: Readonly<Record<BoardScope, string>> = {
	sessions: "Sessions",
	inbox: "Inbox",
	claims: "Claims",
};

const SCOPE_EMPTY: Readonly<Record<BoardScope, string>> = {
	sessions: "No sessions on this bus yet. Press w to join and listen.",
	inbox: "No unread mail.",
	claims: "No claims.",
};

/** A relative age for a message or a claim, e.g. `2.0s ago`, `5m00s ago`. */
function ago(at: number, now: number): string {
	return `${formatDuration(Math.max(0, now - at))} ago`;
}

/** A message body as prose: one paragraph per source line, control characters gone. */
function messageProse(message: BusMessage): string {
	return message.text
		.split("\n")
		.map((line) => sanitizeLine(line))
		.join("\n");
}

/** The paths a message mentions, or an empty string. */
function messagePaths(message: BusMessage): string {
	return message.paths?.length ? message.paths.map((path) => sanitizeLine(path)).join(", ") : "";
}

/** The pane's width-dependent facts: identity, above the claim body. */
function paneFacts(theme: Theme, row: SessionRow, now: number, width: number): string[] {
	const labelWidth = 10;
	return [
		keyValueRow(theme, width, { label: "mode", labelWidth, value: sanitizeLine(row.session.mode) }),
		keyValueRow(theme, width, { label: "id", labelWidth, value: idSuffix(row.session.id) }),
		keyValueRow(theme, width, {
			label: "last seen",
			labelWidth,
			value: ago(row.session.lastSeen, now),
		}),
	];
}

/** The pane body: every claim this session holds, in path order. */
function paneLines(row: SessionRow, now: number): string[] {
	return row.claims.map((claim) => `${sanitizeLine(claim.path)}${SEPARATORS.item}held ${ago(claim.at, now)}`);
}

/** A cheap signature of what the board draws, so a poll repaints only on a change. */
function boardKey(board: BoardSnapshot | undefined): string {
	if (!board) return "";
	return [
		...board.status.sessions.map(
			(session) =>
				`${session.id}:${session.label}:${session.unread}:${session.lastSeen}:${session.mode}:${session.cwd}:${session.state}`,
		),
		...board.status.claims.map((claim) => `${claim.path}:${claim.owner}:${claim.ownerLabel}:${claim.at}`),
		board.status.watching ? `${board.status.watching.armed}:${board.status.watching.wake}` : "",
		...board.messages.map((message) => `${message.id}:${message.at}`),
	].join("|");
}

export interface SessionListCallbacks {
	/** Arm (or disarm) this session's inbox watch, returning the line to show. */
	toggleWatch(armed: boolean): Promise<string>;
	/** Release one of this session's claims, returning the line to show. */
	releaseClaim(path: string): Promise<string>;
}

interface SessionListOptions {
	/** The latest board, or undefined before the first read. */
	latest(): BoardSnapshot | undefined;
	theme: Theme;
	callbacks: SessionListCallbacks;
	onClose(): void;
	requestRender(): void;
	now?: () => number;
	viewportRowsSource?: ViewportRowsSource;
}

/**
 * The `/sessions` board.
 *
 * The rows are derived from a board the command's poll supplies, so the screen
 * never reads the bus itself; `liveDetail` keeps an open pane in step with that
 * board, so a peer that expires or a message that is consumed closes its own pane.
 * The focus is anchored by a scope-prefixed id, so switching scopes lands on the
 * first row of the new list instead of a row that is no longer there.
 */
export class SessionListComponent extends DockListScreen<BoardRow> {
	private board: BoardSnapshot | undefined;
	private scope: BoardScope = "sessions";
	private readonly callbacks: SessionListCallbacks;
	private readonly now: () => number;

	constructor(options: SessionListOptions) {
		super({
			theme: options.theme,
			title: "Sessions",
			detailTitle: "Details",
			emptyList: "No sessions on this bus.",
			emptyDetail: "Nothing to show.",
			requestRender: options.requestRender,
			onClose: options.onClose,
			viewportRowsSource: options.viewportRowsSource,
		});
		this.callbacks = options.callbacks;
		this.now = options.now ?? Date.now;
		this.board = options.latest();
	}

	/** Replace the board; a poll that changed nothing does not repaint. */
	setBoard(board: BoardSnapshot | undefined): void {
		const before = boardKey(this.board);
		this.board = board;
		if (boardKey(board) !== before) this.options.requestRender();
	}

	/** The scope currently listed, for a test or a caller that wants to label it. */
	get currentScope(): BoardScope {
		return this.scope;
	}

	protected headerLabel(): string {
		return SCOPE_TITLE[this.scope];
	}

	protected emptyLabel(): string {
		return SCOPE_EMPTY[this.scope];
	}

	protected rows(): readonly BoardRow[] {
		switch (this.scope) {
			case "sessions":
				return sessionRows(this.board?.status).map((row) => ({ kind: "session", row }));
			case "inbox":
				return (this.board?.messages ?? []).map((message) => ({ kind: "message", message }));
			case "claims":
				return (this.board?.status.claims ?? []).map((claim) => ({ kind: "claim", claim }));
		}
	}

	protected idOf(row: BoardRow): string {
		switch (row.kind) {
			case "session":
				return `s:${row.row.session.id}`;
			case "message":
				return `m:${row.message.id}`;
			case "claim":
				return `c:${row.claim.path}`;
		}
	}

	protected rowLine(row: BoardRow, width: number, selected: boolean): string {
		switch (row.kind) {
			case "session":
				return sessionRowLine(row.row, this.theme, width, { selected });
			case "message":
				return messageRowLine(row.message, this.theme, width, { selected });
			case "claim":
				return claimRowLine(row.claim, this.theme, width, {
					selected,
					self: row.claim.owner === this.me(),
				});
		}
	}

	protected detailBlock(row: BoardRow): string[] {
		switch (row.kind) {
			case "session":
				return sessionDetailBlock(row.row, this.now());
			case "message": {
				const lines = [`received: ${ago(row.message.at, this.now())}`];
				const paths = messagePaths(row.message);
				if (paths) lines.push(`paths: ${paths}`);
				return lines;
			}
			case "claim":
				return [`held ${ago(row.claim.at, this.now())}`];
		}
	}

	protected summaryCells(rows: readonly BoardRow[]): string[] {
		const watching = this.board?.status.watching;
		switch (this.scope) {
			case "sessions": {
				const sessions = rows.flatMap((row) => (row.kind === "session" ? [row.row] : []));
				return summaryCells(this.theme, sessions, watching, this.board?.status.onBus !== false);
			}
			case "inbox": {
				const cells = [paint(this.theme, "meta", count(rows.length, "unread message"))];
				if (watching) cells.push(this.watchCell(watching));
				return cells;
			}
			case "claims": {
				const own = rows.flatMap((row) => (row.kind === "claim" && row.claim.owner === this.me() ? [row] : []));
				const cells = [paint(this.theme, "meta", count(rows.length, "claim"))];
				if (own.length > 0) cells.push(paint(this.theme, "label", `${own.length} yours`));
				return cells;
			}
		}
	}

	protected listHints(): ScreenHint[] {
		const tab = (scope: BoardScope): ScreenHint => ({ text: `Tab ${SCOPE_TITLE[scope].toLowerCase()}` });
		const enter = (verb: string): ScreenHint => ({ text: `Enter ${verb}`, color: "accent" });
		const hints: ScreenHint[] = ["Esc", tab(this.nextScope())];
		switch (this.scope) {
			case "sessions":
				hints.push(enter("open"), this.watchHint(), "↑/↓", "PgUp/PgDn");
				break;
			case "inbox":
				hints.push(enter("read"), this.watchHint(), "↑/↓", "PgUp/PgDn");
				break;
			case "claims":
				hints.push(enter("open"), { text: "x release", color: "warning" }, "↑/↓", "PgUp/PgDn");
				break;
		}
		return hints;
	}

	protected detailHints(row: BoardRow | undefined): ScreenHint[] {
		if (row?.kind === "claim" && row.claim.owner === this.me()) {
			return ["Esc back", { text: "x release", color: "warning" }, "↑/↓ scroll", "g/G ends"];
		}
		return ["Esc back", "↑/↓ scroll", "g/G ends", "PgUp/PgDn"];
	}

	protected detailFor(row: BoardRow): DetailContents {
		switch (row.kind) {
			case "session":
				return {
					title: `${sanitizeLine(row.row.session.label)}${row.row.self ? " · you" : ""}`,
					subtitle: sanitizeLine(row.row.session.cwd),
					lines: paneLines(row.row, this.now()),
					tail: false,
					facts: (width) => paneFacts(this.theme, row.row, this.now(), width),
				};
			case "message": {
				const paths = messagePaths(row.message);
				return {
					title: `${sanitizeLine(row.message.fromLabel)}${SEPARATORS.item}${sanitizeLine(row.message.kind)}`,
					subtitle: `${ago(row.message.at, this.now())}${paths ? `${SEPARATORS.item}paths: ${paths}` : ""}`,
					text: messageProse(row.message),
					tail: false,
				};
			}
			case "claim": {
				// A claim's pane is the session that holds it: identity plus everything it holds.
				const owner = this.ownerRow(row.claim.owner);
				return {
					title: sanitizeLine(row.claim.ownerLabel),
					subtitle: `holds ${sanitizeLine(row.claim.path)}${SEPARATORS.item}held ${ago(row.claim.at, this.now())}`,
					lines: owner ? paneLines(owner, this.now()) : [],
					tail: false,
					...(owner ? { facts: (width: number) => paneFacts(this.theme, owner, this.now(), width) } : {}),
				};
			}
		}
	}

	protected detailById(id: string): { lines: string[] } | undefined {
		const row = this.rows().find((candidate) => this.idOf(candidate) === id);
		if (!row) return undefined;
		switch (row.kind) {
			case "session":
				return { lines: paneLines(row.row, this.now()) };
			case "claim": {
				const owner = this.ownerRow(row.claim.owner);
				return { lines: owner ? paneLines(owner, this.now()) : [] };
			}
			case "message":
				// The pane's body is prose, which the base owns; its presence is all this answers.
				return { lines: [] };
		}
	}

	protected liveDetail(): boolean {
		return true;
	}

	protected handleVerb(key: string, focused: BoardRow | undefined): void {
		if (matchesKey(key, Key.tab)) {
			this.cycleScope();
			return;
		}
		if (key === "w") {
			this.toggleWatch();
			return;
		}
		if (key === "x" && focused?.kind === "claim") this.release(focused.claim);
	}

	protected handleDetailVerb(key: string, row: BoardRow): boolean {
		if (key !== "x" || row.kind !== "claim") return false;
		this.release(row.claim);
		return true;
	}

	private me(): string {
		return this.board?.status.me.id ?? "";
	}

	/** The row for the session with `id`, when it is still on the board. */
	private ownerRow(id: string): SessionRow | undefined {
		return sessionRows(this.board?.status).find((row) => row.session.id === id);
	}

	private nextScope(): BoardScope {
		const index = SCOPE_ORDER.indexOf(this.scope);
		return SCOPE_ORDER[(index + 1) % SCOPE_ORDER.length] ?? "sessions";
	}

	private cycleScope(): void {
		this.scope = this.nextScope();
		this.options.requestRender();
	}

	private watchCell(watching: { armed: boolean; wake: boolean }): string {
		return paint(this.theme, "ok", watching.wake ? "watch wake" : "watch on");
	}

	private watchHint(): ScreenHint {
		return this.board?.status.watching
			? { text: "w watch off", color: "warning" }
			: { text: "w watch on", color: "accent" };
	}

	private toggleWatch(): void {
		const armed = this.board?.status.watching !== undefined;
		void this.callbacks
			.toggleWatch(armed)
			.then((line) => this.notify(line))
			.catch((error) => this.notify(messageOf(error)));
	}

	private release(claim: ClaimRecord): void {
		const path = sanitizeLine(claim.path);
		if (claim.owner !== this.me()) {
			this.notify(`${path} is ${sanitizeLine(claim.ownerLabel)}'s claim; not released.`);
			return;
		}
		this.confirm(`Release ${path}? y/N`, () => {
			void this.callbacks
				.releaseClaim(claim.path)
				.then((line) => this.notify(line))
				.catch((error) => this.notify(messageOf(error)));
		});
	}
}
