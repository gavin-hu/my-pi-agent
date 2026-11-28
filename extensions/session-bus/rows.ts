/**
 * How the bus draws a row: a session, a held path, or a message, as a line for the `/sessions`
 * board and the `session` tool block's expanded result.
 *
 * The words it draws are not its own — a message's sender and kind, its paths and its age come from
 * `format.ts`, which is where every surface's copy of them comes from. What is here is the drawing:
 * the glyph, the role, the width the row is clipped to, and the meta a row trails.
 *
 * Every field came from another session's record, message, or claim, so it is
 * sanitized here, at the boundary that reaches the terminal, and every row is
 * clipped to the width it is given by `listRow`/`statusRow`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { clipText, formatAge, plural, sanitizeLine } from "../../lib/format.ts";
import { clip, usableWidth } from "../../lib/tui/columns.ts";
import { GLYPHS, GLYPH_GAP, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { listRow, statusRow } from "../../lib/tui/rows.ts";
import type { TailRowLine } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { ageText, messageMeta, UNACCOUNTED_PREVIEW } from "./format.ts";
import { forgetCommand, shortId } from "./protocol.ts";
import { type PeerMark, peerMark, type RosterState } from "../../lib/session-roster.ts";
import type { BusMessage, ClaimRecord, SessionRecord, SessionStatus, UnaccountedMessage } from "./types.ts";

/** Columns between a row's body and the trailing cell beside it. */
const TRAILING_GAP = 2;

/** One session on the board, with the claims it holds. */
export interface SessionRow {
	session: SessionRecord & { unread: number; state: RosterState };
	/** Whether this row is the session reading the board. */
	self: boolean;
	claims: ClaimRecord[];
}

/** A row of the transcript's expanded result: one entity per action. */
export type BusRow =
	| { kind: "session"; row: SessionRow }
	| { kind: "claim"; claim: Pick<ClaimRecord, "path" | "ownerLabel"> }
	| { kind: "message"; message: BusMessage }
	| { kind: "orphan"; mail: UnaccountedMessage }
	| { kind: "result"; label: string; tone: "ok" | "warn" };

/** Label order by code unit, so a live re-sort is deterministic. */
function byLabel(a: { label: string }, b: { label: string }): number {
	return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/**
 * The board's rows: this session first, then peers by label, each with its own
 * claims. A status without sessions (a failed read) is an empty board.
 */
export function sessionRows(status: SessionStatus | undefined): SessionRow[] {
	if (!status) return [];
	const rows = status.sessions.map((session) => ({
		session,
		self: session.id === status.me.id,
		claims: status.claims
			.filter((claim) => claim.owner === session.id)
			.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
	}));
	return rows.sort((a, b) => (a.self === b.self ? byLabel(a.session, b.session) : a.self ? -1 : 1));
}

/** One fact a record says, in the two shapes the board prints it: a pane's label and value, and one
 * term of the block's single line. */
export interface RecordFact {
	label: string;
	value: string;
}

/**
 * The mark a record earns on every surface: `gone`, `not listening`, or nothing.
 *
 * It is `peerMark`'s word, not a second spelling of it: the text listing draws the same function
 * (`format.ts`'s `formatStatus`), so one record cannot read `gone` here and something else there.
 */
export function markOf(session: SessionRow["session"]): PeerMark | undefined {
	return peerMark({ state: session.state, listening: session.watching?.armed });
}

/** The roster's word for a peer that is on the bus and not reading its mail. */
const OFF_THE_QUEUE = peerMark({ state: "live", listening: false }) ?? "not listening";

/** The watch's own word, for the facts a record prints: the chip says the same three. */
export function watchWords(watching: SessionRecord["watching"]): string {
	if (watching === undefined) return "not recorded";
	if (!watching.armed) return OFF_THE_QUEUE;
	return watching.wake ? "watch wake" : "watch on";
}

/**
 * What a record says, as the facts the pane and the focus block both print.
 *
 * One owner for one fact: the block joins these into its line and the pane renders them as
 * key/value rows, so the two cannot describe the same record differently. `up` is how long the
 * session has run and `last` when it was last heard from — the two clocks a peer is judged on —
 * and `mail` is that session's own unread beside the claims it holds.
 */
export function recordFacts(row: SessionRow, now: number): RecordFact[] {
	const session = row.session;
	const state = session.state === "gone" ? "gone · process gone" : session.state;
	return [
		// Ordered by what a reader acts on, because the block's line is one clipped line on a narrow
		// board: the count that needs a reader comes before the identity the pane shows in full.
		{ label: "state", value: state },
		{ label: "watch", value: watchWords(session.watching) },
		{ label: "mail", value: `${session.unread} unread · ${plural(row.claims.length, "claim")}` },
		{ label: "up", value: formatAge(now, session.startedAt) },
		{ label: "last", value: ageText(now, session.lastSeen) },
		{ label: "mode", value: `${sanitizeLine(session.mode)} · ${shortId(session.id)}` },
	];
}

/**
 * One session row: the label, a `you` tag on this session, and what the next call acts on — the
 * mark first when the record earns one, then the unread count, then the claims.
 *
 * The mark and the counts share one role, chosen by the mark: a row's trailing cell is painted in
 * one colour by `listRow`, and a per-part role would be a change to the shared kit.
 */
export function sessionRowLine(
	row: SessionRow,
	theme: Theme,
	width: number,
	options: { selected?: boolean; marker?: boolean } = {},
): string {
	const label = `${sanitizeLine(row.session.label)}${row.self ? " · you" : ""}`;
	const mark = markOf(row.session);
	const counts = [`${row.session.unread} unread`];
	if (row.claims.length > 0) counts.push(plural(row.claims.length, "claim"));
	const trailing = [...(mark === undefined ? [] : [mark]), ...counts].join(SEPARATORS.item);
	return listRow(theme, width, {
		selected: options.selected === true,
		marker: options.marker !== false,
		label,
		labelRole: options.selected === true ? "accent" : "label",
		trailing,
		trailingRole: mark === "gone" ? "bad" : mark === "not listening" ? "warn" : "meta",
	});
}

/** One held path: the claim glyph, the path, and the session holding it. */
export function claimRowLine(
	claim: Pick<ClaimRecord, "path" | "ownerLabel">,
	theme: Theme,
	width: number,
	options: { selected?: boolean; marker?: boolean; self?: boolean } = {},
): string {
	const owner = `${sanitizeLine(claim.ownerLabel)}${options.self === true ? " · you" : ""}`;
	return statusRow(theme, width, {
		selected: options.selected === true,
		marker: options.marker !== false,
		glyph: GLYPHS.target,
		glyphRole: "info",
		label: sanitizeLine(claim.path),
		labelRole: options.selected === true ? "accent" : "label",
		trailing: owner,
	});
}

/** The glyph a message of this kind is led by. A handoff is work, not a notification. */
function messageGlyph(kind: BusMessage["kind"]): { glyph: string; role: "warn" | "info" } {
	if (kind === "event") return { glyph: GLYPHS.warn, role: "warn" };
	if (kind === "ask") return { glyph: GLYPHS.unknown, role: "info" };
	if (kind === "handoff") return { glyph: GLYPHS.delegation, role: "info" };
	return { glyph: GLYPHS.pending, role: "info" };
}

/** One message row: the sender and kind as meta trailing the text. */
export function messageRowLine(
	message: BusMessage,
	theme: Theme,
	width: number,
	options: { selected?: boolean; marker?: boolean } = {},
): string {
	const { glyph, role } = messageGlyph(message.kind);
	return statusRow(theme, width, {
		selected: options.selected === true,
		marker: options.marker !== false,
		glyph,
		glyphRole: role,
		label: sanitizeLine(message.text),
		labelRole: options.selected === true ? "accent" : "label",
		trailing: messageMeta(message),
	});
}

/**
 * One message in the expanded transcript block: the row above when its body fits
 * beside the sender, and otherwise a `sender · kind` heading with the body wrapped
 * under it.
 *
 * A message body is prose the reader asked to see, so an expanded block never clips
 * one in mid-sentence: a handoff carries the step to take past the point a clipped
 * row stops, which is the whole reason a wake is worth anything.
 */
export function messageRowLines(message: BusMessage, theme: Theme, width: number): string[] {
	const trailing = messageMeta(message);
	const body = paint(theme, "label", sanitizeLine(message.text));
	const w = usableWidth(width);
	// The glyph and the column after it are reserved on every line, so the wrapped
	// body hangs under its first character instead of restarting at the margin.
	const textColumn = visibleWidth(messageGlyph(message.kind).glyph) + GLYPH_GAP;
	const room = Math.max(1, w - textColumn);
	if (visibleWidth(body) + visibleWidth(trailing) + TRAILING_GAP <= w) {
		return [messageRowLine(message, theme, width, { marker: false })];
	}
	const { glyph, role } = messageGlyph(message.kind);
	const head = statusRow(theme, width, {
		marker: false,
		glyph,
		glyphRole: role,
		label: trailing,
		labelRole: "faint",
		trailing: "",
	});
	const indent = " ".repeat(textColumn);
	return [head, ...wrapTextWithAnsi(body, room).map((line) => clip(`${indent}${line}`, w))];
}

/** The one row renderer the expanded transcript block uses. */
export const busRowLine: TailRowLine<BusRow> = (row, width, theme) => {
	switch (row.kind) {
		case "session":
			return sessionRowLine(row.row, theme, width, { marker: false });
		case "claim":
			return claimRowLine(row.claim, theme, width, { marker: false });
		case "message":
			return messageRowLines(row.message, theme, width);
		case "orphan": {
			// The id is the actionable field — `/sessions drop <id>` is the only door — so it goes in the
			// trailing cell whole, and the body it belongs to is what the row's text column shows.
			return statusRow(theme, width, {
				marker: false,
				glyph: GLYPHS.warn,
				glyphRole: "warn",
				label: sanitizeLine(clipText(row.mail.message.text, UNACCOUNTED_PREVIEW)),
				labelRole: "label",
				trailing: `${sanitizeLine(row.mail.message.id)}${SEPARATORS.item}${messageMeta(row.mail.message)}`,
			});
		}
		case "result":
			return statusRow(theme, width, {
				marker: false,
				glyph: row.tone === "ok" ? GLYPHS.check : GLYPHS.cross,
				glyphRole: row.tone,
				label: sanitizeLine(row.label),
				trailing: "",
			});
	}
};

/**
 * The watch, as one chip: `you: watch on`, `you: watch wake`, or the roster's word when this session
 * is not reading its mail. The Inbox and Claims summaries and `summaryCells` print this one string,
 * so the same watch cannot be two words on two scopes.
 */
export function watchChip(theme: Theme, watching: { armed: boolean; wake: boolean }): string {
	return paint(theme, watching.armed ? "ok" : "warn", `you: ${watchWords(watching)}`);
}

/** The summary cells: the counts a reader scans before the rows. */
export function summaryCells(
	theme: Theme,
	rows: readonly SessionRow[],
	watching: { armed: boolean; wake: boolean } | undefined,
	onBus = true,
	unaccounted = 0,
): string[] {
	// This session's own unread, never the bus's: the Inbox tab counts the mail addressed here, and a
	// word that meant two numbers would be read as the wrong one. Each row still carries its own.
	const unread = rows.find((row) => row.self)?.session.unread ?? 0;
	const claims = rows.reduce((total, row) => total + row.claims.length, 0);
	const gone = rows.filter((row) => row.session.state === "gone").length;
	const cells = [paint(theme, "meta", plural(rows.length, "session"))];
	if (gone > 0) cells.push(paint(theme, "bad", `${gone} gone`));
	if (unread > 0) cells.push(paint(theme, "label", `${unread} unread`));
	// Mail no record holds is not any row's unread count, so it is counted beside them rather than
	// inside one: the number a reader has to act on, and the verb is in the expanded section.
	if (unaccounted > 0) cells.push(paint(theme, "warn", `${unaccounted} unaccounted`));
	cells.push(paint(theme, "meta", plural(claims, "claim")));
	if (watching) cells.push(watchChip(theme, watching));
	if (!onBus) cells.push(paint(theme, "warn", "not on the bus"));
	return cells;
}

/**
 * The focus block under the list: the record's facts in one line, under its cwd.
 *
 * The claims' paths are the pane's to list: the row already counts them, and the facts line says the
 * count, so the block keeps the height a fourth row of them would cost.
 */
export function sessionDetailBlock(row: SessionRow, now: number): string[] {
	const facts = recordFacts(row, now)
		.map((fact) => `${fact.label}: ${fact.value}`)
		.join(SEPARATORS.item);
	const lines = [`cwd: ${sanitizeLine(row.session.cwd)}`, facts];
	if (row.session.state === "gone") lines.push(`forget: ${forgetCommand(row.session.label)}`);
	return lines;
}
