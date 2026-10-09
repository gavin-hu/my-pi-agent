/**
 * Exit-status recovery for background jobs.
 *
 * A job observed only after its process is gone cannot report an exit code from
 * the OS. To recover it, a POSIX job is spawned behind an `EXIT` trap that
 * writes `$?` to a status file, whose path travels in the environment (so the
 * shell never has to quote it). A later session reads that file when it finds a
 * dead pid and reports `exited`/`failed` instead of `unknown`.
 *
 * Windows shells have no equivalent trap, so those jobs keep the old behavior:
 * a reattached job with no code stays `unknown`.
 */

import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

/** Environment variable carrying the status-file path to the wrapped shell. */
export const STATUS_ENV = "PI_JOB_STATUS_FILE";

/** Bytes read from a status file; an exit code is at most a few digits. */
const STATUS_READ_BYTES = 64;

/**
 * `EXIT` trap that records the shell's exit status.
 *
 * The trap survives a normal exit and an explicit `exit N`; `exec cmd` replaces
 * the shell and therefore bypasses it (that job stays `unknown`). Kept as a
 * single line so appending the user's command is unambiguous.
 */
const EXIT_TRAP = `trap '__pi_job_status=$?; printf "%s" "$__pi_job_status" > "$PI_JOB_STATUS_FILE"' EXIT`;

/** Wrap `command` so a POSIX shell records its exit status; a no-op on Windows. */
export function withExitTrap(command: string, isWindows: boolean): string {
	return isWindows ? command : `${EXIT_TRAP}\n${command}`;
}

/** Read a status file as an integer exit code, or undefined when absent/invalid. */
export function readExitStatus(path: string | undefined): number | undefined {
	if (!path) return undefined;
	try {
		if (!existsSync(path)) return undefined;
		const size = Math.min(statSync(path).size, STATUS_READ_BYTES);
		if (size <= 0) return undefined;
		const fd = openSync(path, "r");
		try {
			const buffer = Buffer.alloc(size);
			readSync(fd, buffer, 0, size, 0);
			const text = buffer.toString("utf8").trim();
			if (!/^-?\d+$/.test(text)) return undefined;
			const code = Number(text);
			return Number.isInteger(code) ? code : undefined;
		} finally {
			closeSync(fd);
		}
	} catch {
		return undefined;
	}
}
