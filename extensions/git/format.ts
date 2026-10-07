/**
 * Result formatting for the read-only `git` tool (pure).
 *
 * No terminal access and no theme: given the argv that ran and the captured
 * stdout/stderr, produce the plain text the model and the transcript show.
 */

import type { ExecResult } from "@earendil-works/pi-coding-agent";

/** Longest output kept in a tool result before truncation. */
export const MAX_OUTPUT = 20_000;

export interface GitOutput {
	text: string;
	isError: boolean;
}

/** Turn a git invocation and its result into model-facing text. */
export function formatGitResult(argv: string[], result: ExecResult): GitOutput {
	const command = `$ git ${argv.join(" ")}`;
	const stderr = result.stderr.trim();
	const stdout = result.stdout.trimEnd();

	if (result.code !== 0) {
		const detail = stderr || stdout || `git exited with code ${result.code}`;
		return { text: `${command}\n${detail}`, isError: true };
	}

	if (!stdout) return { text: `${command}\n(no output)`, isError: false };
	const body = stdout.length > MAX_OUTPUT ? `${stdout.slice(0, MAX_OUTPUT)}\n… output truncated` : stdout;
	return { text: body, isError: false };
}
