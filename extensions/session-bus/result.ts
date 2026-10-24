/**
 * The `session` tool's transcript block: the expanded rows one section per entity
 * group, and the one collapsed line a reader sees without expanding.
 *
 * The row grammar and the sanitization live in `rows.ts`; this module only decides
 * which rows an action shows and how the failed ones read.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../lib/format.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { TailResult, type TailResultInput, type TailSection } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { type BusRow, busRowLine, count, sessionRows } from "./rows.ts";
import type { SessionDetails } from "./types.ts";

/**
 * The transcript block for an expanded `session` result: the shared tail block
 * over the board's rows, one section per entity group.
 */
export class SessionResult implements Component {
	private readonly view: TailResult<BusRow>;

	constructor(input: TailResultInput<BusRow>, theme: Theme) {
		this.view = new TailResult(input, theme);
	}

	/** Update in place so the transcript can reuse this component across renders. */
	setInput(input: TailResultInput<BusRow>, theme: Theme): void {
		this.view.setInput(input, theme);
	}

	invalidate(): void {
		this.view.invalidate();
	}

	render(width: number): string[] {
		return this.view.render(width);
	}
}

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
			const sections: TailSection<BusRow>[] = [];
			if (board.length > 0) sections.push(section(board.map((row) => ({ kind: "session", row }))));
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
			if (messages.length === 0) return undefined;
			return { kind: "sections", sections: [section(messages.map((message) => ({ kind: "message", message })))] };
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
		case "join": {
			const conflicts = details.conflicts ?? [];
			const claimed = details.claimed ?? [];
			const rows: BusRow[] = [
				...conflicts.map((claim) => ({ kind: "claim" as const, claim })),
				...claimed.map((label) => ({ kind: "result" as const, label, tone: "ok" as const })),
			];
			if (rows.length === 0) return undefined;
			return {
				kind: "sections",
				sections: [section(rows, conflicts.length > 0 ? "Conflicts" : "Claimed")],
			};
		}
		case "release":
		case "leave": {
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
			if (delivered.length === 0) return undefined;
			return {
				kind: "sections",
				sections: [section(delivered.map((label) => ({ kind: "result", label, tone: "ok" })))],
			};
		}
		case "watch":
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
			const board = sessionRows(details.status);
			const unread = board.reduce((total, row) => total + row.session.unread, 0);
			const claims = board.reduce((total, row) => total + row.claims.length, 0);
			const cells = [count(board.length, "session")];
			if (unread > 0) cells.push(`${unread} unread`);
			cells.push(count(claims, "claim"));
			const units = details.status?.units;
			if (units) cells.push(`${units.joined}/${units.total} units`);
			const watching = details.status?.watching;
			if (watching) cells.push(watching.wake ? "watch wake" : "watch on");
			return paint(theme, "meta", cells.join(sep));
		}
		case "send": {
			const delivered = details.delivered ?? [];
			if (delivered.length === 0) return paint(theme, "meta", "Delivered to nobody");
			return paint(theme, "ok", `Delivered to ${delivered.map((label) => sanitizeLine(label)).join(", ")}`);
		}
		case "inbox": {
			const messages = details.messages ?? [];
			if (messages.length === 0) return paint(theme, "meta", "Inbox empty");
			const senders = [...new Set(messages.map((message) => sanitizeLine(message.fromLabel)))];
			return paint(theme, "meta", `${count(messages.length, "message")}${sep}${senders.join(", ")}`);
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
		case "join": {
			const conflicts = details.conflicts ?? [];
			const where = [details.team, details.unit]
				.filter(Boolean)
				.map((value) => sanitizeLine(value as string))
				.join("/");
			if (conflicts.length > 0) {
				const [first] = conflicts;
				const owner = first ? sanitizeLine(first.ownerLabel) : "a peer";
				return paint(
					theme,
					"warn",
					`Could not join ${where}${sep}${count(conflicts.length, "conflict")} held by ${owner}`,
				);
			}
			const claimed = details.claimed ?? [];
			return paint(theme, "ok", `Joined ${where}${sep}claimed ${claimed.map((path) => sanitizeLine(path)).join(", ")}`);
		}
		case "release":
		case "leave": {
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
		case "watch": {
			const armed = details.watching?.armed === true;
			if (!armed) return paint(theme, "meta", "Inbox watch off");
			return paint(
				theme,
				"ok",
				details.watching?.wake === true ? "Inbox watch on: new mail wakes a turn" : "Inbox watch on",
			);
		}
	}
}
