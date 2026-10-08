/**
 * The rewind timeline: the user prompts on the active session branch, paired
 * with the working-tree snapshot taken before each one.
 *
 * Pure over session entries and stored snapshots so it is testable without a
 * host. `buildRewindPoints` is the bridge between Pi's tree (whose entry ids
 * answer "where in the conversation") and git (whose refs answer "what did the
 * working tree look like").
 */

import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { summarizePrompt } from "./format.ts";
import type { Snapshot } from "./types.ts";

/** What a rewind can restore for one point. */
export type RewindScope = "both" | "conversation" | "code";

/** One user prompt on the active branch, with its code snapshot if any. */
export interface RewindPoint {
	/** Session entry id of the user message; the `navigateTree` target. */
	entryId: string;
	/** Full prompt text, for restoring the editor and the confirm dialog. */
	prompt: string;
	/** Single-line summary for the timeline. */
	summary: string | undefined;
	/** Entry timestamp, epoch milliseconds. */
	timestamp: number;
	/** The `auto` snapshot taken before this prompt, when one exists. */
	snapshot?: Snapshot;
}

/** A user message extracted from the branch. */
export interface BranchUserMessage {
	entryId: string;
	text: string;
	timestamp: number;
}

function isUserMessage(entry: SessionEntry): entry is SessionMessageEntry {
	return entry.type === "message" && entry.message.role === "user";
}

/** The text of a user message, flattening content blocks. */
export function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const candidate = block as { type?: string; text?: unknown };
		if (candidate.type === "text" && typeof candidate.text === "string") parts.push(candidate.text);
	}
	return parts.join("\n").trim();
}

function entryTimestamp(entry: SessionMessageEntry): number {
	const nested = (entry.message as { timestamp?: unknown }).timestamp;
	if (typeof nested === "number") return nested;
	const parsed = Date.parse(entry.timestamp);
	return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The last user-message entry on the branch, or null when there is none. Used
 * as the conversation anchor when snapshotting.
 */
export function lastUserEntryId(branch: readonly SessionEntry[]): string | null {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isUserMessage(entry)) return entry.id;
	}
	return null;
}

/** All user messages on the branch, in branch (oldest-to-newest) order. */
export function userMessagesFromBranch(branch: readonly SessionEntry[]): BranchUserMessage[] {
	const messages: BranchUserMessage[] = [];
	for (const entry of branch) {
		if (!isUserMessage(entry)) continue;
		messages.push({
			entryId: entry.id,
			text: messageText((entry.message as { content?: unknown }).content),
			timestamp: entryTimestamp(entry),
		});
	}
	return messages;
}

/**
 * Pair each branch user message with the earliest `auto` snapshot recorded for
 * that entry in the current session. Returns newest first, matching the menu.
 */
export function buildRewindPoints(
	branch: readonly SessionEntry[],
	snapshots: readonly Snapshot[],
	sessionId: string,
): RewindPoint[] {
	const byEntry = new Map<string, Snapshot>();
	for (const snapshot of snapshots) {
		if (snapshot.reason !== "auto" || !snapshot.entryId || snapshot.sessionId !== sessionId) continue;
		const current = byEntry.get(snapshot.entryId);
		if (!current || snapshot.timestamp < current.timestamp) byEntry.set(snapshot.entryId, snapshot);
	}

	const points = userMessagesFromBranch(branch).map((message) => ({
		entryId: message.entryId,
		prompt: message.text,
		summary: summarizePrompt(message.text),
		timestamp: message.timestamp,
		snapshot: byEntry.get(message.entryId),
	}));
	points.reverse();
	return points;
}

/** Scopes offered for a point: conversation always, code when a snapshot exists. */
export function rewindScopes(point: RewindPoint): RewindScope[] {
	return point.snapshot ? ["both", "conversation", "code"] : ["conversation"];
}
