/**
 * The `session` tool's transcript block: the expanded rows one section per entity
 * group, and the one collapsed line a reader sees without expanding.
 *
 * The row grammar and the sanitization live in `rows.ts`; this module only decides
 * which rows an action shows and how the failed ones read.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../lib/format.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import type { TailResultInput, TailSection } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { type BusRow, busRowLine, count, sessionRows, summaryCells } from "./rows.ts";
import type { SessionDetails } from "./types.ts";

/** One section of the expanded result. */
function section(rows: BusRow[], label?: string): TailSection<BusRow> {
	return { label, rows, more: 0, rowLine: busRowLine };
}

/**
 * The expanded result rows for one action, in the order a reader expects: the
 * board, the consumed mail, a conflict before the claim, released before
 * not-owned. Returns `undefined` when the action has nothing to list.
 */
export function resultSections(details: SessionDetails): TailResultInput<BusRow> | undefined {
	switch (details.action) {
		case "status": {
			const board = sessionRows(details.status);
			const claims = board.flatMap((row) => row.claims);
			const unaccounted = details.status?.unaccounted ?? [];
			const sections: TailSection<BusRow>[] = [];
			if (board.length > 0) sections.push(section(board.map((row) => ({ kind: "session", row }))));
			// Mail no record holds has no session row to sit under, so it is its own section: the id and
			// the body are what a person decides on, and `/sessions drop` is the door the status text names.
			if (unaccounted.length > 0) {
				sections.push(
					section(
						unaccounted.map((mail) => ({ kind: "orphan", mail })),
						`Unaccounted (${unaccounted.length})`,
					),
				);
			}
			if (claims.length > 0) {
				sections.push(
					section(
						claims.map((claim) => ({ kind: "claim", claim })),
						"Claims",
					),
				);
			}
			return sections.length > 0 ? { kind: "sections", sections } : undefined;
		}
		case "inbox": {
			const messages = details.messages ?? [];
			const unreadable = details.unreadable ?? [];
			const sections: TailSection<BusRow>[] = [];
			if (messages.length > 0) {
				sections.push(section(messages.map((message) => ({ kind: "message", message }))));
			}
			// A file this build cannot read is left on disk, so it is named rather than
			// passed off as inbox space: the section is drawn even when no message was
			// consumed, which is the state a reader most needs to be told about.
			if (unreadable.length > 0) {
				sections.push(
					section(
						unreadable.map((file) => ({ kind: "result", label: file, tone: "warn" })),
						"Unreadable mail",
					),
				);
			}
			return sections.length > 0 ? { kind: "sections", sections } : undefined;
		}
		case "claim": {
			const conflicts = details.conflicts ?? [];
			if (conflicts.length > 0) {
				return {
					kind: "sections",
					sections: [
						section(
							conflicts.map((claim) => ({ kind: "claim", claim })),
							"Conflicts",
						),
					],
				};
			}
			const claimed = details.claimed ?? [];
			if (claimed.length === 0) return undefined;
			return {
				kind: "sections",
				sections: [
					section(
						claimed.map((label) => ({ kind: "result", label, tone: "ok" })),
						"Claimed",
					),
				],
			};
		}
		case "release": {
			const released = details.released ?? [];
			const notOwned = details.notOwned ?? [];
			const sections: TailSection<BusRow>[] = [];
			if (released.length > 0) {
				sections.push(
					section(
						released.map((label) => ({ kind: "result", label, tone: "ok" })),
						"Released",
					),
				);
			}
			if (notOwned.length > 0) {
				sections.push(
					section(
						notOwned.map((label) => ({ kind: "result", label, tone: "warn" })),
						"Not yours",
					),
				);
			}
			return sections.length > 0 ? { kind: "sections", sections } : undefined;
		}
		case "send": {
			const delivered = details.delivered ?? [];
			const failed = details.failed ?? [];
			const sections: TailSection<BusRow>[] = [];
			if (delivered.length > 0) {
				sections.push(
					section(
						delivered.map((label) => ({ kind: "result", label, tone: "ok" })),
						"Delivered",
					),
				);
			}
			if (failed.length > 0) {
				sections.push(
					section(
						failed.map((entry) => ({ kind: "result", label: `${entry.label} \u2014 ${entry.error}`, tone: "warn" })),
						"Not delivered",
					),
				);
			}
			return sections.length > 0 ? { kind: "sections", sections } : undefined;
		}
		case "join":
			return undefined;
	}
}

/**
 * The collapsed result line: the one thing the user needs without expanding.
 *
 * A conflict or a path this session does not own is worth the warning role; a
 * successful claim, release, or send is routine, so those stay calm.
 */
export function collapsedLine(theme: Theme, details: SessionDetails): string {
	const sep = SEPARATORS.item;
	switch (details.action) {
		case "status": {
			// The cells are the board's, so a gone session and a reader that has not joined
			// read the same on the bar as on `/sessions` — and the summary stays one line,
			// where a sentence spelling out what to do next would wrap it.
			const cells = summaryCells(
				theme,
				sessionRows(details.status),
				details.status?.watching,
				details.status?.onBus !== false,
				details.status?.unaccounted?.length ?? 0,
			);
			return cells.join(paint(theme, "faint", sep));
		}
		case "send": {
			const delivered = details.delivered ?? [];
			const failed = details.failed ?? [];
			if (delivered.length === 0) return paint(theme, "meta", "Delivered to nobody");
			const line = paint(theme, "ok", `Delivered to ${delivered.map((label) => sanitizeLine(label)).join(", ")}`);
			// A recipient the message could not be written for is the one fact the delivered list
			// leaves out, so it is drawn rather than left to the expanded section.
			return failed.length === 0
				? line
				: `${line}${paint(theme, "faint", SEPARATORS.item)}${paint(theme, "warn", `${failed.length} not delivered`)}`;
		}
		case "inbox": {
			const messages = details.messages ?? [];
			const unreadable = details.unreadable ?? [];
			const cells: string[] = [];
			if (messages.length > 0) {
				const senders = [...new Set(messages.map((message) => sanitizeLine(message.fromLabel)))];
				cells.push(paint(theme, "meta", `${count(messages.length, "message")}${sep}${senders.join(", ")}`));
			}
			// A refused file is not an empty inbox: it is the one fact the call leaves out,
			// so the count is drawn here and the names are the expanded section's.
			if (unreadable.length > 0) cells.push(paint(theme, "warn", count(unreadable.length, "unreadable file")));
			return cells.length > 0 ? cells.join(paint(theme, "faint", sep)) : paint(theme, "meta", "Inbox empty");
		}
		case "claim": {
			const conflicts = details.conflicts ?? [];
			if (conflicts.length > 0) {
				const [first] = conflicts;
				const more = conflicts.length - 1;
				const path = first ? sanitizeLine(first.path) : "a path";
				const owner = first ? sanitizeLine(first.ownerLabel) : "a peer";
				return paint(
					theme,
					"warn",
					`${count(conflicts.length, "conflict")}${sep}${path} held by ${owner}${more > 0 ? ` +${more} more` : ""}`,
				);
			}
			const claimed = details.claimed ?? [];
			if (claimed.length === 0) return paint(theme, "meta", "Claimed nothing");
			return paint(theme, "ok", `Claimed ${claimed.map((path) => sanitizeLine(path)).join(", ")}`);
		}
		case "release": {
			const released = details.released ?? [];
			const notOwned = details.notOwned ?? [];
			const parts: string[] = [];
			if (released.length > 0)
				parts.push(paint(theme, "ok", `Released ${released.map((path) => sanitizeLine(path)).join(", ")}`));
			if (notOwned.length > 0) {
				parts.push(paint(theme, "warn", `Not yours: ${notOwned.map((path) => sanitizeLine(path)).join(", ")}`));
			}
			return parts.length > 0 ? parts.join(paint(theme, "faint", sep)) : paint(theme, "meta", "Nothing to release");
		}
		case "join": {
			const label = paint(theme, "ok", sanitizeLine(details.label ?? ""));
			const state =
				details.watching?.armed !== true
					? paint(theme, "meta", "not listening")
					: paint(theme, "meta", details.watching.wake === true ? "listening, wake" : "listening");
			return `${label}${paint(theme, "faint", sep)}${state}`;
		}
	}
}
