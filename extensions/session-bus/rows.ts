/**
 * The bus row grammar: the one place a session, a held path, or a message is
 * turned into a line, shared by the `/sessions` board and the `session` tool
 * block's expanded result.
 *
 * Every field came from another session's record, message, or claim, so it is
 * sanitized here, at the boundary that reaches the terminal, and every row is
 * clipped to the width it is given by `listRow`/`statusRow`.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatDuration, sanitizeLine } from "../../lib/format.ts";
import { clip, usableWidth } from "../../lib/tui/columns.ts";
import { GLYPHS, GLYPH_GAP, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { listRow, statusRow } from "../../lib/tui/rows.ts";
import type { TailRowLine } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { idSuffix } from "./format.ts";
import type { RosterState } from "../../lib/session-roster.ts";
import type { BusMessage, ClaimRecord, SessionRecord, SessionStatus } from "./types.ts";

/** Claim paths the focus block lists before it points at the pane. */
const BLOCK_CLAIMS = 2;

/** Columns between a row's body and the trailing cell beside it. */
const TRAILING_GAP = 2;

/** `1 claim`, `2 claims`. */
export function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

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

/** One session row: the label, a `you` tag on this session, and its counts. */
export function sessionRowLine(
	row: SessionRow,
	theme: Theme,
	width: number,
	options: { selected?: boolean; marker?: boolean } = {},
): string {
	const label = `${sanitizeLine(row.session.label)}${row.self ? " · you" : ""}`;
	const counts = [row.session.state === "gone" ? "gone" : `${row.session.unread} unread`];
	if (row.claims.length > 0) counts.push(count(row.claims.length, "claim"));
	return listRow(theme, width, {
		selected: options.selected === true,
		marker: options.marker !== false,
		label,
		labelRole: options.selected === true ? "accent" : "label",
		trailing: counts.join(SEPARATORS.item),
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

/** The sender and the kind, as the meta a message row closes with. */
function messageTrailing(message: BusMessage): string {
	return `${sanitizeLine(message.fromLabel)}${SEPARATORS.item}${sanitizeLine(message.kind)}`;
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
		trailing: messageTrailing(message),
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
	const trailing = messageTrailing(message);
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

/** The summary cells: the counts a reader scans before the rows. */
export function summaryCells(
	theme: Theme,
	rows: readonly SessionRow[],
	watching: { armed: boolean; wake: boolean } | undefined,
	onBus = true,
): string[] {
	const unread = rows.reduce((total, row) => total + row.session.unread, 0);
	const claims = rows.reduce((total, row) => total + row.claims.length, 0);
	const gone = rows.filter((row) => row.session.state === "gone").length;
	const cells = [paint(theme, "meta", count(rows.length, "session"))];
	if (gone > 0) cells.push(paint(theme, "bad", `${gone} gone`));
	if (unread > 0) cells.push(paint(theme, "label", `${unread} unread`));
	cells.push(paint(theme, "meta", count(claims, "claim")));
	if (watching) cells.push(paint(theme, "ok", watching.wake ? "watch wake" : "watch on"));
	if (!onBus) cells.push(paint(theme, "warn", "not on the bus"));
	return cells;
}

/** The focus block under the list: what the row does not already say. */
export function sessionDetailBlock(row: SessionRow, now: number): string[] {
	const lines = [`cwd: ${sanitizeLine(row.session.cwd)}`];
	if (row.claims.length > 0) {
		const shown = row.claims.slice(0, BLOCK_CLAIMS).map((claim) => sanitizeLine(claim.path));
		const hidden = row.claims.length - shown.length;
		lines.push(`claims: ${shown.join(", ")}${hidden > 0 ? ` +${hidden} more` : ""}`);
	}
	lines.push(
		`mode: ${sanitizeLine(row.session.mode)}${SEPARATORS.item}id: ${idSuffix(row.session.id)}` +
			`${SEPARATORS.item}last seen: ${formatDuration(Math.max(0, now - row.session.lastSeen))} ago` +
			`${row.session.state === "gone" ? `${SEPARATORS.item}process gone` : ""}`,
	);
	return lines;
}
