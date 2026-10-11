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
 *
 * The entry script is what makes that work, and it is the part that is easy to
 * get wrong: `argv[1]` only names a script when the runtime was *given* one. A
 * single-file build (Bun's `--compile`, for example) has no interpreter and no
 * script — it puts the first user argument there, so `pi notes.md` must not be
 * read as a script to re-execute. The process facts arrive as {@link PiRuntime}
 * so the rule is testable without touching the real process.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The command and leading arguments for a nested Pi process. */
export interface PiInvocation {
	command: string;
	args: string[];
}

/** The process facts {@link getPiInvocation} resolves against. */
export interface PiRuntime {
	/** `process.execPath`: the binary running this code. */
	execPath: string;
	/** `process.argv[1]`: the entry script, when the runtime was handed one. */
	entryScript?: string;
	/** `process.versions.bun`: set in every Bun process, including a compiled build. */
	bunVersion?: string;
}

/** The live process's facts. */
function currentRuntime(): PiRuntime {
	return { execPath: process.execPath, entryScript: process.argv[1], bunVersion: process.versions.bun };
}

/** The entry script, when it is a real file another process can run. */
function entryScriptOf(runtime: PiRuntime): string | undefined {
	const script = runtime.entryScript;
	// A bundled Bun script lives in the virtual `/$bunfs` filesystem, which no
	// other process can re-execute.
	if (!script || script.startsWith("/$bunfs/root/") || !fs.existsSync(script)) return undefined;
	return script;
}

/**
 * Resolve how to launch a nested `pi` process with `args`.
 *
 * A generic interpreter (`node`, `bun`) was started with Pi's entry script, so
 * both halves are reused; when that script is unusable the fallback is `pi` on
 * `PATH`. Any other binary either *is* Pi — a standalone build, where
 * `execPath` alone is the whole command — or is an interpreter under another
 * name, which still takes the script.
 */
export function getPiInvocation(args: string[], runtime: PiRuntime = currentRuntime()): PiInvocation {
	const execName = path.basename(runtime.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	const isStandalone = !isGenericRuntime && (/^pi(\.exe)?$/.test(execName) || runtime.bunVersion !== undefined);
	const script = isStandalone ? undefined : entryScriptOf(runtime);

	if (script) return { command: runtime.execPath, args: [script, ...args] };
	if (isGenericRuntime) return { command: "pi", args };
	return { command: runtime.execPath, args };
}
