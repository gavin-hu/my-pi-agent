/**
 * The external-CLI seam for `read_doc`.
 *
 * Each document format is extracted by an ArtCraft command-line tool that reads
 * the file itself: `pdfcraft-cli` for PDF, `wordcraft-cli` for DOCX, and
 * `gridcraft-cli` for XLSX. This module owns the process seam, the "tool
 * missing" classification, and the install guidance, so the three extractors
 * stay tiny and testable through an injected {@link DocCli}.
 *
 * The tools are invoked with `pi.exec`, which resolves a missing binary as
 * `{ code: 1, stderr: "" }` rather than throwing. A command that fails with a
 * message on stderr is a real failure; one that fails silently is re-checked
 * with `<cli> --version`, and a failed probe means the tool is not installed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** The three extractor executables. */
export type CliName = "pdfcraft-cli" | "wordcraft-cli" | "gridcraft-cli";

/** The subset of `pi.exec`'s result the seam consumes. */
export interface CliResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

/** A raw process runner; production uses {@link createExecRunner}. */
export type RunCli = (command: string, args: string[], options?: { signal?: AbortSignal }) => Promise<CliResult>;

/** What an extractor receives: the real, root-confined absolute path. */
export interface DocFile {
	/** Absolute, symlink-resolved path inside the effective working root. */
	path: string;
	/** The active turn's abort signal, forwarded to the CLI. */
	signal?: AbortSignal;
}

/** Extract plain text for one file via `cli`. */
export type DocExtractor = (file: DocFile, cli: DocCli) => Promise<string>;

/** The runner an extractor uses. */
export interface DocCli {
	/** Run a CLI command; returns stdout, throws on failure or a missing tool. */
	run(cli: CliName, args: string[], options?: { signal?: AbortSignal }): Promise<string>;
}

/** Per-CLI wording for the model-facing install hint. */
const CLI_INFO: Record<CliName, { noun: string; repo: string }> = {
	"pdfcraft-cli": { noun: "PDF", repo: "storytold/pdfcraft" },
	"wordcraft-cli": { noun: "DOCX", repo: "storytold/wordcraft" },
	"gridcraft-cli": { noun: "XLSX", repo: "storytold/gridcraft" },
};

/** Raised when a needed extractor executable is not installed. */
export class CliUnavailableError extends Error {
	constructor(readonly cli: CliName) {
		super(cliGuidance(cli));
		this.name = "CliUnavailableError";
	}
}

/** Model-facing guidance naming the install command for a missing CLI. */
export function cliGuidance(cli: CliName): string {
	const { noun, repo } = CLI_INFO[cli];
	return (
		`${noun} extraction needs the '${cli}' executable on PATH. Install it with ` +
		`\`cargo install --git https://github.com/${repo} ${cli}\`, or a release build from ` +
		`https://github.com/${repo}.`
	);
}

/** Back {@link RunCli} with `pi.exec`. */
export function createExecRunner(pi: Pick<ExtensionAPI, "exec">): RunCli {
	return async (command, args, options) => {
		const result = await pi.exec(command, args, { signal: options?.signal });
		return { stdout: result.stdout, stderr: result.stderr, code: result.code, killed: result.killed };
	};
}

/** Probe for a CLI by running its `--version`. All three support it. */
async function isAvailable(cli: CliName, run: RunCli, options?: { signal?: AbortSignal }): Promise<boolean> {
	try {
		const probe = await run(cli, ["--version"], options);
		return probe.code === 0;
	} catch {
		return false;
	}
}

/**
 * Build a {@link DocCli} over a raw runner.
 *
 * A command that exits non-zero with a message surfaces that message. A silent
 * failure is only reported as a missing tool when the `--version` probe fails
 * too; otherwise it is a plain non-zero exit.
 */
export function createDocCli(run: RunCli): DocCli {
	return {
		async run(cli, args, options) {
			const result = await run(cli, args, options);
			if (result.code === 0) return result.stdout;

			const detail = result.stderr.trim();
			if (detail) throw new Error(detail);
			if (!(await isAvailable(cli, run, options))) throw new CliUnavailableError(cli);
			throw new Error(`${cli} exited with code ${result.code}.`);
		},
	};
}
