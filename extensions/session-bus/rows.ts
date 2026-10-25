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
import { formatDuration, sanitizeLine } from "../../lib/format.ts";
import { GLYPHS, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { listRow, statusRow } from "../../lib/tui/rows.ts";
import type { TailRowLine } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { idSuffix } from "./format.ts";
import type { BusMessage, ClaimRecord, SessionRecord, SessionStatus } from "./types.ts";

/** Claim paths the focus block lists before it points at the pane. */
const BLOCK_CLAIMS = 2;

/** `1 claim`, `2 claims`. */
export function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** One session on the board, with the claims it holds. */
export interface SessionRow {
	session: SessionRecord & { unread: number };
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
	const counts = [`${row.session.unread} unread`];
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

/** One message row: the sender and kind as meta trailing the text. */
export function messageRowLine(
	message: BusMessage,
	theme: Theme,
	width: number,
	options: { selected?: boolean; marker?: boolean } = {},
): string {
	const glyph = message.kind === "event" ? GLYPHS.warn : message.kind === "ask" ? GLYPHS.unknown : GLYPHS.pending;
	return statusRow(theme, width, {
		selected: options.selected === true,
		marker: options.marker !== false,
		glyph,
		glyphRole: message.kind === "event" ? "warn" : "info",
		label: sanitizeLine(message.text),
		labelRole: options.selected === true ? "accent" : "label",
		trailing: `${sanitizeLine(message.fromLabel)}${SEPARATORS.item}${sanitizeLine(message.kind)}`,
	});
}

/** The one row renderer the expanded transcript block uses. */
export const busRowLine: TailRowLine<BusRow> = (row, width, theme) => {
	switch (row.kind) {
		case "session":
			return sessionRowLine(row.row, theme, width, { marker: false });
		case "claim":
			return claimRowLine(row.claim, theme, width, { marker: false });
		case "message":
			return messageRowLine(row.message, theme, width, { marker: false });
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
	const cells = [paint(theme, "meta", count(rows.length, "session"))];
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
			`${SEPARATORS.item}last seen: ${formatDuration(Math.max(0, now - row.session.lastSeen))} ago`,
	);
	return lines;
}
