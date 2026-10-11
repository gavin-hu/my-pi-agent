/**
 * Resolving how to launch a nested `pi` process.
 *
 * `subagent` uses this to run its children, and `doctor` probes it to report
 * whether delegation can work at all. It lives in `lib/` rather than in
 * `subagent` so both read one rule instead of two that drift.
 *
 * The rule mirrors the bundled example: prefer reusing the current interpreter
 * plus Pi's own entry script, so a subagent runs the same build that dispatched
 * it, and only fall back to a generic `pi` binary on `PATH`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The command and leading arguments for a nested Pi process. */
export interface PiInvocation {
	command: string;
	args: string[];
}

/**
 * Resolve how to launch a nested `pi` process with `args`.
 *
 * When Pi's own entry script is a real file, reuse it with `process.execPath`.
 * When the runtime is a bundled/generic node or bun, fall back to `pi` on PATH.
 */
export function getPiInvocation(args: string[]): PiInvocation {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}
