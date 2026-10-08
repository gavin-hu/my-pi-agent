/**
 * Parameter schema and validation for the `job` tool.
 *
 * Validation is pure and runs before any side effect, so a programmatic caller
 * such as `codemode`, which bypasses the TypeBox schema, cannot start a process
 * with missing arguments. Failures throw a model-readable `Error`.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { JOB_ACTIONS, KILL_SIGNALS, type JobAction, type KillSignal } from "./types.ts";

/** Longest accepted command string. */
export const MAX_COMMAND = 4000;
/** Longest accepted label. */
export const MAX_LABEL = 120;
/** Bounds for `logs.lines`. */
const MIN_LOG_LINES = 1;
const MAX_LOG_LINES = 2000;
/** Bounds for `wait.timeoutMs`. */
const MAX_WAIT_MS = 600_000;

export const JobParams = Type.Object({
	action: StringEnum(JOB_ACTIONS),
	command: Type.Optional(Type.String({ description: "Shell command to run in the background (for `start`)." })),
	cwd: Type.Optional(Type.String({ description: "Working directory; defaults to the session cwd." })),
	label: Type.Optional(Type.String({ description: "Short display label; defaults to the command." })),
	wake: Type.Optional(Type.Boolean({ description: "Wake the agent with one triggered turn when the job finishes." })),
	detached: Type.Optional(Type.Boolean({ description: "Leave the job running when the session ends." })),
	id: Type.Optional(Type.String({ description: "Job id, e.g. `j1`." })),
	lines: Type.Optional(
		Type.Integer({ minimum: MIN_LOG_LINES, maximum: MAX_LOG_LINES, description: "Log lines to return." }),
	),
	signal: Type.Optional(StringEnum(KILL_SIGNALS, { description: "Signal for `kill`; defaults to SIGTERM." })),
	timeoutMs: Type.Optional(
		Type.Integer({ minimum: 0, maximum: MAX_WAIT_MS, description: "How long `wait` blocks before returning." }),
	),
	all: Type.Optional(Type.Boolean({ description: "With `clear`, remove every finished job." })),
});

export type JobArgs = Static<typeof JobParams>;

/** A validated call: the action plus the fields that action uses. */
export interface JobCall {
	action: JobAction;
	command?: string;
	cwd?: string;
	label?: string;
	wake?: boolean;
	detached?: boolean;
	id?: string;
	lines?: number;
	signal?: KillSignal;
	timeoutMs?: number;
	all?: boolean;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Validate and normalize a raw `job` call. Throws before any side effect. */
export function normalizeCall(raw: unknown): JobCall {
	const args = (raw ?? {}) as JobArgs;
	const action = typeof args.action === "string" ? (args.action as JobAction) : undefined;
	if (!action || !(JOB_ACTIONS as readonly string[]).includes(action)) {
		throw new Error(`action must be one of ${JOB_ACTIONS.join(", ")}.`);
	}

	const id = optionalString(args.id);
	if ((action === "status" || action === "logs" || action === "kill" || action === "wait") && !id) {
		throw new Error(`"${action}" requires an id (e.g. "j1").`);
	}

	const call: JobCall = { action, id };
	if (action === "start") {
		const command = typeof args.command === "string" ? args.command.trim() : "";
		if (!command) throw new Error('"start" requires a command.');
		if (command.length > MAX_COMMAND) throw new Error(`command is longer than ${MAX_COMMAND} characters.`);
		call.command = command;
		const label = optionalString(args.label);
		if (label && label.length > MAX_LABEL) throw new Error(`label is longer than ${MAX_LABEL} characters.`);
		call.label = label;
		const cwd = optionalString(args.cwd);
		if (cwd) call.cwd = cwd;
		if (typeof args.wake === "boolean") call.wake = args.wake;
		if (typeof args.detached === "boolean") call.detached = args.detached;
	}
	if (action === "logs") {
		const lines = typeof args.lines === "number" ? Math.round(args.lines) : undefined;
		if (lines !== undefined && (lines < MIN_LOG_LINES || lines > MAX_LOG_LINES)) {
			throw new Error(`lines must be between ${MIN_LOG_LINES} and ${MAX_LOG_LINES}.`);
		}
		call.lines = lines;
	}
	if (action === "kill") {
		const signal = args.signal;
		if (signal !== undefined && !(KILL_SIGNALS as readonly string[]).includes(signal)) {
			throw new Error(`signal must be one of ${KILL_SIGNALS.join(", ")}.`);
		}
		call.signal = signal;
	}
	if (action === "wait") {
		const timeoutMs = typeof args.timeoutMs === "number" ? Math.round(args.timeoutMs) : undefined;
		if (timeoutMs !== undefined && (timeoutMs < 0 || timeoutMs > MAX_WAIT_MS)) {
			throw new Error(`timeoutMs must be between 0 and ${MAX_WAIT_MS}.`);
		}
		call.timeoutMs = timeoutMs;
	}
	if (action === "clear" && typeof args.all === "boolean") call.all = args.all;

	return call;
}
