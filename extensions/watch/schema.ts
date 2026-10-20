/**
 * Parameter schema and validation for the `watch` tool.
 *
 * Validation is pure and runs before any side effect, so a programmatic caller
 * such as `codemode`, which bypasses the TypeBox schema, cannot start a watcher
 * with missing arguments or an invalid regular expression. Failures throw a
 * model-readable `Error`.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { optionalString } from "../../lib/config.ts";
import { WATCH_ACTIONS, type WatchAction } from "./types.ts";

/** Longest accepted label. */
export const MAX_LABEL = 120;
/** Longest accepted pattern or exclude expression. */
export const MAX_PATTERN = 2000;
/** Longest accepted path or command string. */
export const MAX_SOURCE = 4000;
/** Most exclude patterns accepted. */
export const MAX_EXCLUDE = 64;
/** Bounds for `matches`/`logs` line counts. */
export const MIN_LINES = 1;
export const MAX_LINES = 2000;

export const WatchParams = Type.Object({
	action: StringEnum(WATCH_ACTIONS),
	id: Type.Optional(Type.String({ description: "Watcher id, e.g. `w1`." })),
	path: Type.Optional(Type.String({ description: "File to tail (`add`)." })),
	command: Type.Optional(Type.String({ description: "Shell command whose output to tail (`add`)." })),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for a command source; defaults to the session cwd." }),
	),
	pattern: Type.Optional(Type.String({ description: "Regular expression a line must match (`add`)." })),
	exclude: Type.Optional(
		Type.Array(Type.String(), { description: "Regular expressions that suppress a match (`add`)." }),
	),
	caseSensitive: Type.Optional(
		Type.Boolean({ description: "Match case-sensitively; default false (case-insensitive)." }),
	),
	label: Type.Optional(Type.String({ description: "Short display label (`add`)." })),
	wake: Type.Optional(
		Type.Boolean({ description: "Wake the agent with one triggered turn when this watcher matches (`add`)." }),
	),
	fromStart: Type.Optional(
		Type.Boolean({ description: "Scan a file's existing content before following new lines (`add`); default false." }),
	),
	lines: Type.Optional(
		Type.Integer({ minimum: MIN_LINES, maximum: MAX_LINES, description: "Lines to return (`matches`/`logs`)." }),
	),
	all: Type.Optional(Type.Boolean({ description: "With `clear`, also stop and remove running watchers." })),
});

export type WatchArgs = Static<typeof WatchParams>;

/**
 * A validated call: the action plus exactly the fields that action uses.
 *
 * A discriminated union so callers narrow on `action` and never need a
 * non-null assertion for the required fields of a branch.
 */
export type WatchCall =
	| {
			action: "add";
			path?: string;
			command?: string;
			cwd?: string;
			pattern: string;
			exclude?: string[];
			caseSensitive?: boolean;
			label?: string;
			wake?: boolean;
			fromStart?: boolean;
	  }
	| { action: "list" }
	| { action: "status"; id: string }
	| { action: "matches"; id: string; lines?: number }
	| { action: "logs"; id: string; lines?: number }
	| { action: "stop"; id: string }
	| { action: "clear"; id?: string; all?: boolean };

function assertRegex(value: string, field: string): void {
	if (value.length > MAX_PATTERN) throw new Error(`${field} is longer than ${MAX_PATTERN} characters.`);
	try {
		new RegExp(value);
	} catch (error) {
		throw new Error(`${field} is not a valid regular expression: ${(error as Error).message}`);
	}
}

/** Validate and normalize a raw `watch` call. Throws before any side effect. */
export function normalizeCall(raw: unknown): WatchCall {
	const args = (raw ?? {}) as WatchArgs;
	const action = typeof args.action === "string" ? (args.action as WatchAction) : undefined;
	if (!action || !(WATCH_ACTIONS as readonly string[]).includes(action)) {
		throw new Error(`action must be one of ${WATCH_ACTIONS.join(", ")}.`);
	}

	const id = optionalString(args.id);
	const requireId = (): string => {
		if (!id) throw new Error(`"${action}" requires an id (e.g. "w1").`);
		return id;
	};
	const optionalLines = (): number | undefined => {
		const lines = typeof args.lines === "number" ? Math.round(args.lines) : undefined;
		if (lines !== undefined && (lines < MIN_LINES || lines > MAX_LINES)) {
			throw new Error(`lines must be between ${MIN_LINES} and ${MAX_LINES}.`);
		}
		return lines;
	};

	switch (action) {
		case "add": {
			const path = optionalString(args.path);
			const command = typeof args.command === "string" ? args.command.trim() : "";
			if (path && command) throw new Error('"add" accepts either a path or a command, not both.');
			if (!path && !command) throw new Error('"add" requires a path or a command.');
			if (path && path.length > MAX_SOURCE) throw new Error(`path is longer than ${MAX_SOURCE} characters.`);
			if (command.length > MAX_SOURCE) throw new Error(`command is longer than ${MAX_SOURCE} characters.`);

			const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
			if (!pattern) throw new Error('"add" requires a pattern.');
			assertRegex(pattern, "pattern");

			const rawExclude = Array.isArray(args.exclude) ? args.exclude : [];
			if (rawExclude.length > MAX_EXCLUDE) throw new Error(`exclude accepts at most ${MAX_EXCLUDE} patterns.`);
			const exclude: string[] = [];
			for (const entry of rawExclude) {
				const text = typeof entry === "string" ? entry.trim() : "";
				if (!text) continue;
				assertRegex(text, "exclude");
				exclude.push(text);
			}

			const label = optionalString(args.label);
			if (label && label.length > MAX_LABEL) throw new Error(`label is longer than ${MAX_LABEL} characters.`);
			const cwd = optionalString(args.cwd);

			return {
				action: "add",
				...(path ? { path } : {}),
				...(command ? { command } : {}),
				...(cwd ? { cwd } : {}),
				pattern,
				...(exclude.length > 0 ? { exclude } : {}),
				...(typeof args.caseSensitive === "boolean" ? { caseSensitive: args.caseSensitive } : {}),
				...(label ? { label } : {}),
				...(typeof args.wake === "boolean" ? { wake: args.wake } : {}),
				...(typeof args.fromStart === "boolean" ? { fromStart: args.fromStart } : {}),
			};
		}
		case "list":
			return { action: "list" };
		case "status":
			return { action: "status", id: requireId() };
		case "matches": {
			const lines = optionalLines();
			return { action: "matches", id: requireId(), ...(lines !== undefined ? { lines } : {}) };
		}
		case "logs": {
			const lines = optionalLines();
			return { action: "logs", id: requireId(), ...(lines !== undefined ? { lines } : {}) };
		}
		case "stop":
			return { action: "stop", id: requireId() };
		case "clear":
			return {
				action: "clear",
				...(id ? { id } : {}),
				...(typeof args.all === "boolean" ? { all: args.all } : {}),
			};
	}
}
