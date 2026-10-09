/**
 * Pure text for the memory tool, the `/memory` command, and the injected
 * context body.
 *
 * No terminal access and no theme; callers apply colors. The injected body is
 * bounded by a byte cap so a large store cannot crowd out the conversation.
 */

import type { MemoryDetails, MemoryScope } from "./types.ts";

/** Marker heading the hidden injected context message. */
export const MEMORY_CONTEXT_MARKER = "[MEMORY]";

const INTRO = "Durable notes saved in earlier sessions. Treat them as facts the user asked you to remember.";
/** Bytes kept in reserve so the omission tail always fits under the cap. */
const TAIL_RESERVE = 64;
/** Notes listed per scope in an unexpanded result or the command notice. */
const LIST_CAP = 12;

export interface MemoryEntries {
	project: string[];
	global: string[];
}

function bytes(text: string): number {
	return Buffer.byteLength(text, "utf-8");
}

export function scopeLabel(scope: MemoryScope): string {
	return scope === "global" ? "global" : "project";
}

export function entriesFor(entries: MemoryEntries, scope: MemoryScope): string[] {
	return scope === "global" ? entries.global : entries.project;
}

/** `N project, M global` summary. */
export function countLine(entries: MemoryEntries): string {
	return `${entries.project.length} project, ${entries.global.length} global`;
}

/**
 * One-line body for the transcript call renderer; the renderer owns the styled
 * `memory ` title. Returns an empty body for an incomplete call with no known
 * action, and `→ …` while the arguments are still streaming.
 */
export function formatCallText(
	args: { action?: unknown; text?: unknown; scope?: unknown },
	argsComplete = true,
): string {
	const action = typeof args.action === "string" ? args.action.toLowerCase() : "";
	if (action === "list") return "→ list";
	if (action !== "add" && action !== "forget") return argsComplete ? "" : "→ …";
	const scope = scopeLabel(args.scope === "global" ? "global" : "project");
	const text = typeof args.text === "string" ? args.text.trim() : "";
	return text ? `→ ${action} (${scope}): ${text}` : `→ ${action} (${scope})`;
}

function listLines(label: string, list: string[], expanded: boolean): string[] {
	if (list.length === 0) return [`${label}: none`];
	const shown = expanded ? list : list.slice(0, LIST_CAP);
	const lines = [`${label} (${list.length}):`, ...shown.map((entry) => `- ${entry}`)];
	if (shown.length < list.length) lines.push(`- (+${list.length - shown.length} more)`);
	return lines;
}

/** Model-facing result text. */
export function formatResultText(details: MemoryDetails, expanded = false): string {
	if (details.error) return `Error: ${details.error}`;
	const entries: MemoryEntries = { project: details.project, global: details.global };
	switch (details.action) {
		case "list":
			return [
				`Memory (${countLine(entries)}).`,
				...listLines("project", entries.project, expanded),
				...listLines("global", entries.global, expanded),
			].join("\n");
		case "add":
			return details.changed
				? `Added to ${scopeLabel(details.scope)} memory: ${details.entry ?? ""}\nNow ${countLine(entries)}.`
				: `Already in ${scopeLabel(details.scope)} memory: ${details.entry ?? ""}`;
		case "forget":
			return `Removed from ${scopeLabel(details.scope)} memory: ${details.entry ?? ""}\nNow ${countLine(entries)}.`;
	}
}

/** Multi-line text for the `/memory` command. */
export function formatNotice(entries: MemoryEntries): string {
	if (entries.project.length + entries.global.length === 0) return "No durable memory stored yet.";
	return ["Memory:", ...listLines("project", entries.project, true), ...listLines("global", entries.global, true)].join(
		"\n",
	);
}

/**
 * The hidden `[MEMORY]` context body, or `undefined` when nothing is stored.
 *
 * Sections are emitted project-then-global. When the notes do not fit under
 * `maxBytes`, the remainder is replaced by one `(+N more)` tail so the model
 * knows to call the tool for the rest.
 */
export function buildInjection(entries: MemoryEntries, maxBytes: number): string | undefined {
	const sections: Array<[MemoryScope, string[]]> = [];
	if (entries.project.length > 0) sections.push(["project", entries.project]);
	if (entries.global.length > 0) sections.push(["global", entries.global]);
	if (sections.length === 0) return undefined;

	const lines = [MEMORY_CONTEXT_MARKER, INTRO];
	let used = lines.reduce((total, line) => total + bytes(line) + 1, 0);
	const limit = Math.max(0, maxBytes - TAIL_RESERVE);
	let omitted = 0;

	for (const [scope, list] of sections) {
		const header = `${scope}:`;
		const rendered: string[] = [];
		for (const entry of list) {
			const line = `- ${entry}`;
			if (used + bytes(header) + 1 + bytes(line) + 1 > limit) {
				omitted += 1;
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
	if (omitted > 0) lines.push(`- (+${omitted} more; use the memory tool)`);
	return lines.join("\n");
}
