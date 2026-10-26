/**
 * The `/worktree` list screen: one row per managed worktree, the active one
 * marked, with a detail pane and three verbs.
 *
 * The frame, navigation, y/N confirmation, and pane come from the shared
 * `DockListScreen`, so this module owns only the worktree vocabulary. Rows come
 * from the same `worktreeSnapshot` the text status renders and their marks from the
 * same `statusMarks`, so the screen and the `list_worktrees` tool cannot disagree
 * about a worktree.
 *
 * Every verb but `p` closes the screen and hands the action back to the command:
 * entering and exiting change the session binding and `exitWorktree` asks through
 * `ctx.ui.select`, which cannot nest inside a mount. `p` never prompts, so it
 * runs in place and refreshes the rows.
 */

import { basename } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import { planModeRefusal } from "../../lib/plan-entry.ts";
import type { ScreenHint, ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { DockListScreen, type DetailContents } from "../../lib/tui/dock-screen.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { statusRow } from "../../lib/tui/rows.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";
import { gapLines } from "./gaps.ts";
import { handoffLines } from "./handoff.ts";
import type { CheckoutStatus } from "./registry.ts";
import { relativeDay, statusMarks, type WorktreeSnapshot, worktreeLabel } from "./status.ts";

/** What a verb asks the command to do once the screen is gone. */
export type WorktreeAction = { kind: "enter"; name: string } | { kind: "exit" };

/** One row: a managed worktree, or the active one when this session does not manage it. */
export interface WorktreeRow {
	/** Canonical path, and the row's stable id. */
	path: string;
	/** Basename of the path: the name `enter` takes back. */
	name: string;
	branch: string | undefined;
	/** Whether this row is the session's active worktree. */
	current: boolean;
	/** What git says about it; absent for a worktree entered by path. */
	status: CheckoutStatus | undefined;
}

/** The rows for a snapshot, in git's order, with the active worktree always present. */
export function worktreeRows(snapshot: WorktreeSnapshot): WorktreeRow[] {
	const rows: WorktreeRow[] = snapshot.managed.map((item) => ({
		path: item.entry.path,
		name: basename(item.entry.path),
		branch: item.entry.branch,
		current: snapshot.active?.path === item.entry.path,
		status: item.status,
	}));
	const active = snapshot.active;
	// A worktree entered by path is not in the managed list, but a reader looking
	// for "where am I" must still see it.
	if (active && !rows.some((row) => row.path === active.path)) {
		rows.unshift({
			path: active.path,
			name: worktreeLabel(active),
			branch: active.branch,
			current: true,
			status: undefined,
		});
	}
	return rows;
}

/** The glyph and its role: a missing checkout is the error, dirty work the warning. */
function rowGlyph(status: CheckoutStatus | undefined): { char: string; role: TuiRole } {
	if (!status) return { char: GLYPHS.worktree, role: "info" };
	if (status.state === "missing") return { char: GLYPHS.cross, role: "bad" };
	if (status.state === "dirty") return { char: GLYPHS.warn, role: "warn" };
	if (status.merged) return { char: GLYPHS.check, role: "ok" };
	return { char: GLYPHS.branch, role: "info" };
}

/** The row's right-hand text: its marks, worded once in `statusMarks`. */
function rowMarks(row: WorktreeRow): string {
	return (row.status ? statusMarks(row.status, row.current) : ["current"]).join("  ");
}

export interface WorktreeScreenOptions {
	/** The rows to open with; the command has already read them. */
	snapshot: WorktreeSnapshot;
	theme: Theme;
	requestRender(): void;
	/** Close the screen; `undefined` when the user only closed it. */
	onDone(action: WorktreeAction | undefined): void;
	/** Read the rows again after a verb changed them. */
	reload(): Promise<WorktreeSnapshot>;
	/** Run a prune in place and return its report. */
	prune(): Promise<string>;
	/** Plan mode: the screen still shows the list, but no verb may change it. */
	readOnly: boolean;
	viewportRowsSource?: ViewportRowsSource;
}

/** The `/worktree` screen. */
export class WorktreeListComponent extends DockListScreen<WorktreeRow> {
	private view: WorktreeSnapshot;
	private pruning = false;

	constructor(private readonly deps: WorktreeScreenOptions) {
		super({
			theme: deps.theme,
			title: "Worktrees",
			detailTitle: "Worktree",
			emptyList: "No managed worktrees. /worktree enter <name> creates one.",
			emptyDetail: "Nothing recorded for this worktree.",
			requestRender: deps.requestRender,
			onClose: () => deps.onDone(undefined),
			viewportRowsSource: deps.viewportRowsSource,
		});
		this.view = deps.snapshot;
	}

	protected rows(): readonly WorktreeRow[] {
		return worktreeRows(this.view);
	}

	protected idOf(row: WorktreeRow): string {
		return row.path;
	}

	protected rowLine(row: WorktreeRow, width: number, selected: boolean): string {
		const glyph = rowGlyph(row.status);
		return statusRow(this.theme, width, {
			selected,
			glyph: glyph.char,
			glyphRole: glyph.role,
			label: row.name,
			labelRole: selected ? "accent" : "label",
			trailing: rowMarks(row),
			trailingRole: row.current ? "accent" : "faint",
		});
	}

	protected detailBlock(row: WorktreeRow): string[] {
		const lines = [`${row.path}  ${row.branch ?? "(detached)"}`];
		const active = this.view.active;
		// The gaps are the same rules `/worktree` status and `doctor` report: a gap
		// the user cannot see is a gap they cannot weigh.
		if (row.current && active) {
			lines.push(`base: ${active.baseRef} (${active.baseRefMode})    main: ${active.repoRoot}`);
			if (this.view.gaps.length > 0) lines.push("Not isolated:", ...gapLines(this.view.gaps));
		}
		return lines;
	}

	protected summaryCells(rows: readonly WorktreeRow[]): string[] {
		const cells = [paint(this.theme, "meta", `${rows.length} worktree${rows.length === 1 ? "" : "s"}`)];
		const dirty = rows.filter((row) => row.status?.state === "dirty").length;
		if (dirty > 0) cells.push(paint(this.theme, "warn", `${dirty} dirty`));
		const ahead = rows.filter((row) => (row.status?.ahead ?? 0) > 0).length;
		if (ahead > 0) cells.push(paint(this.theme, "accent", `${ahead} ahead`));
		const inactive = this.view.inactiveOverrides;
		if (inactive.length > 0) cells.push(paint(this.theme, "warn", `not isolated: ${inactive.join(", ")}`));
		return cells;
	}

	protected listHints(): ScreenHint[] {
		return [
			"Esc close",
			"↑/↓ or j/k select",
			{ text: "Enter or l detail", color: "accent" },
			{ text: "e enter", color: "accent" },
			{ text: "x exit", color: "warning" },
			{ text: "p prune", color: "warning" },
		];
	}

	protected detailHints(): ScreenHint[] {
		return ["Esc back", "↑/↓ scroll", "g/G ends"];
	}

	protected detailFor(row: WorktreeRow): DetailContents {
		const lines = [`path    ${row.path}`, `branch  ${row.branch ?? "(detached)"}`];
		const status = row.status;
		if (!status) {
			lines.push("state   entered by path; this session does not manage it");
		} else {
			if (status.head) lines.push(`head    ${status.head.slice(0, 7)}`);
			const bits = [status.state === "dirty" ? `dirty (${status.changed} changed)` : "clean"];
			if (status.ahead > 0) bits.push(`${status.ahead} ahead`);
			if (status.behind > 0) bits.push(`${status.behind} behind`);
			// The row says it too, and for the same reason: a merged mark is a claim that work
			// landed, which a worktree with no commits of its own cannot make.
			if (status.commits === 0) bits.push("no commits");
			else if (status.merged) {
				if (status.commits !== undefined) bits.push(`${status.commits} commits`);
				bits.push("merged");
			}
			lines.push(`state   ${bits.join(", ")}`);
			if (status.locked) {
				lines.push(`lock    ${status.staleLock ? "stale (owner is gone)" : "held by a live session"}`);
			}
			if (status.lastUsedAt) lines.push(`used    ${relativeDay(status.lastUsedAt)}`);
			// The handoff is read, not performed: a merge lands in the main checkout.
			if (status.ahead > 0 && row.branch) {
				lines.push(
					"",
					...handoffLines({
						branch: row.branch,
						base: this.view.baseBranch ?? null,
						ahead: status.ahead,
						commits: status.commits,
						merged: status.merged,
					}),
				);
			}
		}
		return { title: row.name, lines, subtitle: row.branch ?? row.path };
	}

	protected handleVerb(key: string, row: WorktreeRow | undefined): void {
		if (key !== "e" && key !== "x" && key !== "p") return;
		if (this.deps.readOnly) {
			this.notify(planModeRefusal("changing worktrees"));
			return;
		}
		if (key === "e") {
			if (!row) {
				this.notify("No worktree to enter.");
				return;
			}
			if (row.current) {
				this.notify(`${row.name} is already the current worktree.`);
				return;
			}
			if (this.view.active) {
				this.notify(`Still in ${worktreeLabel(this.view.active)}; press x to exit first.`);
				return;
			}
			this.deps.onDone({ kind: "enter", name: row.name });
			return;
		}
		if (key === "x") {
			if (!this.view.active) {
				this.notify("Not in a worktree.");
				return;
			}
			this.deps.onDone({ kind: "exit" });
			return;
		}
		if (this.pruning) {
			this.notify("A prune is already running.");
			return;
		}
		this.pruning = true;
		this.notify("Pruning…");
		void this.pruneInPlace();
	}

	/** Prune is the one verb that never prompts, so it runs without closing the screen. */
	private async pruneInPlace(): Promise<void> {
		try {
			const report = await this.deps.prune();
			this.view = await this.deps.reload();
			this.resort();
			this.notify(report.split("\n")[0] ?? "Pruned.");
		} catch (error) {
			this.notify(`Prune failed: ${messageOf(error)}`);
		} finally {
			this.pruning = false;
		}
	}
}
