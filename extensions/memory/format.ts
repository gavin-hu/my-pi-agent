/**
 * Pure text for the memory tool, the `/memory` command, and the injected
 * context body.
 *
 * No terminal access and no theme; callers apply colors. The injected body is
 * bounded by a byte cap so a large store cannot crowd out the conversation.
 */

import { noteLabel, type MemoryDetails, type MemoryNote, type MemoryScope } from "./types.ts";

/** Marker heading the hidden injected context message. */
export const MEMORY_CONTEXT_MARKER = "[MEMORY]";

const INTRO = "Durable notes saved in earlier sessions. Treat them as facts the user asked you to remember.";
/** Bytes kept in reserve so the omission tail always fits under the cap. */
const TAIL_RESERVE = 96;
/** Notes listed per scope in an unexpanded result or the command notice. */
const LIST_CAP = 12;

export interface MemoryEntries {
	project: MemoryNote[];
	global: MemoryNote[];
}

/** UTF-8 bytes, which is the unit every cap and byte count here speaks. */
export function bytes(text: string): number {
	return Buffer.byteLength(text, "utf-8");
}

export function scopeLabel(scope: MemoryScope): string {
	return scope === "global" ? "global" : "project";
}

/** `N project, M global` summary. */
function countLine(entries: { project: unknown[]; global: unknown[] }): string {
	return `${entries.project.length} project, ${entries.global.length} global`;
}

/**
 * One-line body for the transcript call renderer; the renderer owns the styled
 * `memory ` title. Returns an empty body for an incomplete call with no known
 * action, and `→ …` while the arguments are still streaming.
 */
export function formatCallText(
	args: {
		action?: unknown;
		text?: unknown;
		to?: unknown;
		first?: unknown;
		second?: unknown;
		merged?: unknown;
		scope?: unknown;
	},
	argsComplete = true,
): string {
	const action = typeof args.action === "string" ? args.action.toLowerCase() : "";
	if (action === "list") return "→ list";
	if (action !== "add" && action !== "forget" && action !== "update" && action !== "merge") {
		return argsComplete ? "" : "→ …";
	}
	const scope = scopeLabel(args.scope === "global" ? "global" : "project");
	if (action === "merge") {
		const first = typeof args.first === "string" ? args.first.trim() : "";
		const second = typeof args.second === "string" ? args.second.trim() : "";
		const merged = typeof args.merged === "string" ? args.merged.trim() : "";
		if (!first) return `→ merge (${scope})`;
		if (!second || !merged) return `→ merge (${scope}): ${first}`;
		return `→ merge (${scope}): ${first} + ${second} → ${merged}`;
	}
	const text = typeof args.text === "string" ? args.text.trim() : "";
	if (action === "update") {
		const to = typeof args.to === "string" ? args.to.trim() : "";
		if (!text) return `→ update (${scope})`;
		return to ? `→ update (${scope}): ${text} → ${to}` : `→ update (${scope}): ${text}`;
	}
	return text ? `→ ${action} (${scope}): ${text}` : `→ ${action} (${scope})`;
}

/** The labels a reader sees for one scope's notes: `[jack] text`, or the bare text. */
export function noteLabels(notes: MemoryNote[]): string[] {
	return notes.map(noteLabel);
}

function listLines(label: string, list: string[], expanded: boolean): string[] {
	if (list.length === 0) return [`${label}: none`];
	const shown = expanded ? list : list.slice(0, LIST_CAP);
	const lines = [`${label} (${list.length}):`, ...shown.map((entry) => `- ${entry}`)];
	if (shown.length < list.length) lines.push(`- (+${list.length - shown.length} more)`);
	return lines;
}

/** What the picker says after a merge, an update or a forget, once the store has answered. */
export function mutationNotice(verb: "merge" | "update" | "forget", changed: boolean, scope: MemoryScope): string {
	const label = scopeLabel(scope);
	if (verb === "merge") return changed ? `Merged 2 ${label} notes.` : "Those notes are no longer both here.";
	if (verb === "forget") return changed ? `Forgot ${label} note.` : "That note was already gone.";
	return changed ? `Updated ${label} note.` : "That note is no longer here.";
}

/** Model-facing result text. */
export function formatResultText(details: MemoryDetails, expanded = false): string {
	if (details.error) return `Error: ${details.error}`;
	// The details carry labels, so this half of the module renders strings and never unwraps a note.
	const entries = { project: details.project, global: details.global };
	switch (details.action) {
		case "list":
			return [
				`Memory (${countLine(entries)}).`,
				...listLines("project", entries.project, expanded),
				...listLines("global", entries.global, expanded),
			].join("\n");
		case "add":
			if (details.changed) {
				// The call line already names the note, so the result confirms the write
				// and the new counts rather than repeating it.
				return `Added to ${scopeLabel(details.scope)} memory\nNow ${countLine(entries)}.`;
			}
			if (details.existing !== undefined && details.existing !== details.entry) {
				return `Already in ${scopeLabel(details.scope)} memory (near-duplicate): ${details.existing}`;
			}
			return `Already in ${scopeLabel(details.scope)} memory: ${details.existing ?? details.entry ?? ""}`;
		case "update":
			return details.changed
				? `Updated ${scopeLabel(details.scope)} memory\nNow ${countLine(entries)}.`
				: `Already set in ${scopeLabel(details.scope)} memory: ${details.entry ?? ""}`;
		case "forget":
			return `Removed from ${scopeLabel(details.scope)} memory\nNow ${countLine(entries)}.`;
		case "merge":
			// A merge that changed nothing is refused before this is built — the tool answers with
			// an error carrying the notes, and `error` is read above the switch.
			return `Merged 2 ${scopeLabel(details.scope)} notes\nNow ${countLine(entries)}.`;
	}
}

/** Multi-line text for the `/memory` command. */
export function formatNotice(entries: MemoryEntries): string {
	if (entries.project.length + entries.global.length === 0) return "No durable memory stored yet.";
	return [
		"Memory:",
		...listLines("project", noteLabels(entries.project), true),
		...listLines("global", noteLabels(entries.global), true),
	].join("\n");
}

/**
 * The hidden `[MEMORY]` context body split into its lines, plus what did not fit.
 *
 * Sections are emitted project-then-global, newest note first: a note's position in
 * the store is its age (`applyAdd` appends, and `applyUpdate` moves a correction to
 * the end), so a note that does not fit is the oldest one. The remainder is replaced
 * by one tail naming both the call and the store's size, since the notes a cap leaves
 * out are ones only a person can prune. `omitted` says which store overflowed, for the
 * health report; `buildInjection` only needs the lines.
 */
export interface InjectionPlan {
	lines: string[];
	/** Notes that did not fit, per scope. */
	omitted: Record<MemoryScope, number>;
}

/** Plan the injected body, or `undefined` when nothing is stored. */
export function injectionPlan(entries: MemoryEntries, maxBytes: number): InjectionPlan | undefined {
	const project = noteLabels(entries.project);
	const global = noteLabels(entries.global);
	const sections: Array<[MemoryScope, string[]]> = [];
	if (project.length > 0) sections.push(["project", project]);
	if (global.length > 0) sections.push(["global", global]);
	if (sections.length === 0) return undefined;

	const lines = [MEMORY_CONTEXT_MARKER, INTRO];
	let used = lines.reduce((total, line) => total + bytes(line) + 1, 0);
	const limit = Math.max(0, maxBytes - TAIL_RESERVE);
	const omitted: Record<MemoryScope, number> = { project: 0, global: 0 };

	for (const [scope, list] of sections) {
		const header = `${scope}:`;
		const rendered: string[] = [];
		for (const entry of [...list].reverse()) {
			const line = `- ${entry}`;
			if (used + bytes(header) + 1 + bytes(line) + 1 > limit) {
				omitted[scope] += 1;
				continue;
			}
			rendered.push(line);
			used += bytes(line) + 1;
		}
		if (rendered.length > 0) {
			lines.push(header, ...rendered);
			used += bytes(header) + 1;
		}
	}
	const missing = omitted.project + omitted.global;
	if (missing > 0) lines.push(`- (+${missing} more; call list — the store is past the injection cap)`);
	return { lines, omitted };
}

/**
 * The hidden `[MEMORY]` context body, or `undefined` when nothing is stored.
 * Bounded by `maxBytes`, with one tail naming what did not fit.
 */
export function buildInjection(entries: MemoryEntries, maxBytes: number): string | undefined {
	return injectionPlan(entries, maxBytes)?.lines.join("\n");
}
