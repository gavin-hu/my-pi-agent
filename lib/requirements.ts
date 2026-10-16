/**
 * Per-extension runtime prerequisites.
 *
 * One place that says what each extension needs in order to actually work, plus
 * a pure probe over injected seams. `doctor` reports on this table, and the
 * extensions that own an external dependency format their error text from the
 * same entries, so the hint a model sees in a tool error and the hint `doctor`
 * prints cannot drift apart.
 *
 * The table is data: no module state, no I/O, no host access. Everything a probe
 * needs (running a command, reading a file, loading an optional package, the
 * platform, the directories) arrives as a seam, the same way `RunGit` does in
 * `lib/git/runner.ts`. That keeps `probeExtension` testable with no process and
 * keeps `lib/` value-only.
 */

import { join } from "node:path";
import { type JsonReadResult, SHARED_CONFIG_FILE } from "./config.ts";
import { getPiInvocation, type PiInvocation } from "./pi-invocation.ts";

/** How a check came out. Only `missing` is worth interrupting a session for. */
export type FindingSeverity = "ok" | "missing" | "degraded" | "info";

/** A required executable, probed with `--version` unless `invocation` overrides it. */
export interface BinaryCheck {
	kind: "binary";
	/** Executable name, also the label shown in the report. */
	name: string;
	/** Probe arguments; defaults to `["--version"]`. */
	probeArgs?: readonly string[];
	/** Resolve the probe command instead of using `name` (for a runtime-resolved binary). */
	invocation?: () => PiInvocation;
	/** What stops working without it, phrased for the report. */
	enables: string;
	/** What to do about it. */
	hint: string;
}

/** An optional npm package that is imported lazily. */
export interface ModuleCheck {
	kind: "module";
	name: string;
	enables: string;
	hint: string;
}

/** A file that must exist and, when it is JSON, parse. */
export interface StateCheck {
	kind: "state";
	scope: "agent" | "project";
	/** Path relative to the scope directory. */
	file: string;
	enables: string;
	hint: string;
}

/** A runtime-resolved command, probed only when it is not the running process. */
export interface InvocationCheck {
	kind: "invocation";
	enables: string;
	hint: string;
}

export type RequirementCheck = BinaryCheck | ModuleCheck | StateCheck | InvocationCheck;

/** What an extension needs, split by how badly it needs it. */
export interface ExtensionRequirements {
	/** Config files read through `lib/config.ts`, for the malformed-JSON check. */
	readonly configFiles?: readonly string[];
	/** Unmet checks here mean the extension cannot do its job. */
	readonly requires?: readonly RequirementCheck[];
	/** Unmet checks here mean reduced capability. */
	readonly optional?: readonly RequirementCheck[];
	/** Expected behaviour on this platform or mode; reported, never warned. */
	readonly notes?: readonly string[];
}

/** One probe result. Every check reports, including the ones that passed. */
export interface Finding {
	extension: string;
	/** Short label: the binary, module, or file that was checked. */
	check: string;
	severity: FindingSeverity;
	/** What was found, or what the check covers when it passed. */
	detail: string;
	/** What to do next, when there is something to do. */
	hint?: string;
}

/** One extension's probe results. */
export interface ExtensionReport {
	extension: string;
	enabled: boolean;
	findings: Finding[];
}

// --- Install guidance -------------------------------------------------------
//
// Moved here from the extensions that raise it, so `doctor` and the tool error
// say the same thing. Formatting only: no extension-specific logic.

/** Install command for the optional PDF extractor package. */
const UNPDF_INSTALL = "npm i unpdf";

/** Model-facing guidance when the optional `unpdf` package is absent. */
export function pdfGuidance(): string {
	return `PDF extraction requires the optional 'unpdf' package (${UNPDF_INSTALL}).`;
}

// --- The table --------------------------------------------------------------

/**
 * The `git` binary, described in terms of the extension that needs it. One
 * shared sentence would name another extension's features in this one's report.
 */
function gitCheck(enables: string): BinaryCheck {
	return {
		kind: "binary",
		name: "git",
		enables,
		hint: "install git and make sure it is on PATH (https://git-scm.com/downloads).",
	};
}

/** Every extension's prerequisites, keyed by directory name. */
export const REQUIREMENTS: Readonly<Record<string, ExtensionRequirements>> = {
	worktree: {
		requires: [gitCheck("worktree isolation")],
		notes: ["`.worktreeinclude` symlinks need symlink support (Windows Developer Mode)."],
	},
	rewind: {
		requires: [gitCheck("rewind snapshots")],
	},
	question: {
		notes: ["Needs an interactive UI; without one the tool stays inactive."],
	},
	todo: {},
	goal: {},
	plan: {
		optional: [gitCheck("project-local `.pi/plans` (otherwise plans land in the agent directory)")],
		notes: ["Needs an interactive UI to enter plan mode."],
	},
	subagent: {
		requires: [
			{
				kind: "invocation",
				enables: "delegating to a nested pi process",
				hint: "make sure the pi command is on PATH, or run from an installation Pi can re-execute.",
			},
		],
		notes: ["Project-local agents require a trusted project."],
	},
	job: {
		notes: [
			"Windows: no POSIX `EXIT` trap, so a reattached job's status stays `unknown`.",
			"`ps` is used for the pid-reuse guard and is POSIX-only.",
		],
	},
	watch: {
		notes: [
			"A command watcher spawns a shell; its process tree is killed when the watcher stops or the session ends.",
			"File watchers poll, so a line can take up to `watch.pollMs` to surface.",
		],
	},
	"web-access": {
		optional: [{ kind: "module", name: "unpdf", enables: "PDF text extraction in `web_fetch`", hint: pdfGuidance() }],
	},
	"file-browse": {
		optional: [gitCheck("the branch chip")],
		notes: ["The default-browser opener (`open` / `xdg-open` / `cmd`) is best-effort; the URL is printed either way."],
	},
	document: {},
	"file-open": {
		notes: [
			"The `/open` command and its notification need an interactive UI; the `open_path` tool works without one.",
			"Launching the OS handler is best-effort: a failure is reported, and the tool result still names the target.",
		],
	},
	memory: {
		optional: [gitCheck("project-scope memory under the repository root")],
	},
	wechat: {
		optional: [
			{
				kind: "state",
				scope: "agent",
				file: join("wechat", "credentials.json"),
				enables: "the WeChat bridge",
				hint: "run `/wechat login` to scan the QR code.",
			},
		],
		notes: ["Logging in needs the interactive terminal UI."],
	},
	bytefly: {
		configFiles: [SHARED_CONFIG_FILE],
		notes: [
			"TUI only for the header, footer, and turn rule; `/bytefly` prints a listing and `/bytefly doctor` the report in RPC, JSON, and print modes.",
			"The panel writes extension enablement through Pi's own settings; project scope requires a trusted project.",
			"`/bytefly`'s list screen and the proactive missing-prerequisite warning need an interactive UI.",
		],
	},
};

// --- Probing ----------------------------------------------------------------

/** Run a command and report its exit code; production backs this with `pi.exec`. */
export type ExecSeam = (command: string, args: string[]) => Promise<{ code: number }>;

/** The directories a check resolves its paths against. */
export interface DirSeams {
	/** Pi's agent directory (`getAgentDir()`). */
	agentDir: string;
	/** The session working directory. */
	cwd: string;
	/** The project config directory name (`CONFIG_DIR_NAME`, normally `.pi`). */
	configDirName: string;
}

/** Everything a probe needs from the outside world. */
export interface ProbeSeams {
	exec: ExecSeam;
	/** Validate a file with its reason, not silently (see `lib/config.ts`). */
	readJson: (path: string) => JsonReadResult;
	dirs: DirSeams;
	platform: NodeJS.Platform;
	/** Whether the package will actually load this extension this session. */
	isEnabled: (extension: string) => boolean;
	/** Load an optional package; defaults to a real dynamic import. */
	loadModule?: (name: string) => Promise<unknown>;
	/** Resolve the nested-pi command; defaults to {@link getPiInvocation}. */
	invocation?: () => PiInvocation;
}

const defaultLoadModule = (name: string): Promise<unknown> => import(name);

/** Probe one command, treating a throwing seam as an unusable binary. */
async function probeCode(invocation: PiInvocation, seams: ProbeSeams): Promise<number> {
	try {
		const result = await seams.exec(invocation.command, invocation.args);
		return result.code;
	} catch {
		return 1;
	}
}

/** Run one check. `failSeverity` comes from which list the check sits in. */
async function runCheck(
	extension: string,
	check: RequirementCheck,
	failSeverity: FindingSeverity,
	seams: ProbeSeams,
): Promise<Finding> {
	switch (check.kind) {
		case "binary": {
			const invocation = check.invocation?.() ?? {
				command: check.name,
				args: [...(check.probeArgs ?? ["--version"])],
			};
			const code = await probeCode(invocation, seams);
			return code === 0
				? { extension, check: check.name, severity: "ok", detail: check.enables }
				: {
						extension,
						check: check.name,
						severity: failSeverity,
						detail: `not found on PATH — ${check.enables}`,
						hint: check.hint,
					};
		}
		case "module": {
			const load = seams.loadModule ?? defaultLoadModule;
			try {
				await load(check.name);
			} catch {
				return {
					extension,
					check: check.name,
					severity: failSeverity,
					detail: `not installed — ${check.enables}`,
					hint: check.hint,
				};
			}
			return { extension, check: check.name, severity: "ok", detail: check.enables };
		}
		case "state": {
			const path = join(scopeDir(check.scope, seams.dirs), check.file);
			const result = seams.readJson(path);
			if (result.state === "ok") return { extension, check: path, severity: "ok", detail: check.enables };
			if (result.state === "absent") {
				return {
					extension,
					check: path,
					severity: failSeverity,
					detail: `missing — ${check.enables}`,
					hint: check.hint,
				};
			}
			return {
				extension,
				check: path,
				severity: failSeverity,
				detail: `unreadable (${result.error}) — ${check.enables}`,
				hint: check.hint,
			};
		}
		case "invocation": {
			const invocation = seams.invocation?.() ?? getPiInvocation(["--version"]);
			// Reusing the running interpreter cannot fail: the process is running.
			const code = invocation.command === process.execPath ? 0 : await probeCode(invocation, seams);
			return code === 0
				? { extension, check: invocation.command, severity: "ok", detail: check.enables }
				: {
						extension,
						check: invocation.command,
						severity: failSeverity,
						detail: `cannot be run — ${check.enables}`,
						hint: check.hint,
					};
		}
	}
}

function scopeDir(scope: "agent" | "project", dirs: DirSeams): string {
	return scope === "agent" ? dirs.agentDir : join(dirs.cwd, dirs.configDirName);
}

/**
 * A config file that exists but does not parse is invisible today: both reads
 * go through `readJson`, which swallows the error. `doctor` names the file and
 * the reason instead. An absent file is normal, so it is not reported.
 */
function configFindings(extension: string, spec: ExtensionRequirements, seams: ProbeSeams): Finding[] {
	const files = spec.configFiles ?? [];
	const findings: Finding[] = [];
	for (const file of files) {
		const candidates: Array<[string, string]> = [
			["global", join(seams.dirs.agentDir, file)],
			["project", join(seams.dirs.cwd, seams.dirs.configDirName, file)],
		];
		for (const [scope, path] of candidates) {
			const result = seams.readJson(path);
			if (result.state === "error") {
				findings.push({
					extension,
					check: path,
					severity: "degraded",
					detail: `the ${scope} config is ignored because it is not valid JSON (${result.error})`,
					hint: `fix or delete ${path}`,
				});
			}
		}
	}
	return findings;
}

/** Probe one extension against its declaration and the current environment. */
export async function probeExtension(extension: string, seams: ProbeSeams): Promise<ExtensionReport> {
	const spec = REQUIREMENTS[extension];
	const enabled = seams.isEnabled(extension);
	if (!spec) {
		return {
			extension,
			enabled,
			findings: [
				{
					extension,
					check: "declaration",
					severity: "info",
					detail: "no prerequisites are declared for this extension",
				},
			],
		};
	}
	if (!enabled) {
		return {
			extension,
			enabled,
			findings: [
				{
					extension,
					check: "state",
					severity: "info",
					detail: "disabled through PI_DISABLED_EXTENSIONS",
				},
			],
		};
	}

	const findings: Finding[] = [];
	for (const check of spec.requires ?? []) findings.push(await runCheck(extension, check, "missing", seams));
	for (const check of spec.optional ?? []) findings.push(await runCheck(extension, check, "degraded", seams));
	findings.push(...configFindings(extension, spec, seams));
	for (const note of spec.notes ?? []) {
		findings.push({ extension, check: "platform", severity: "info", detail: note });
	}
	return { extension, enabled, findings };
}

/**
 * Probe every declared extension, or just `names`, in declaration order.
 *
 * Sequential on purpose: the caller runs this on a session-start budget, and a
 * burst of parallel probes would trade a few milliseconds for a burst of child
 * processes.
 */
export async function probeAll(
	seams: ProbeSeams,
	names: readonly string[] = Object.keys(REQUIREMENTS),
): Promise<ExtensionReport[]> {
	const reports: ExtensionReport[] = [];
	for (const name of names) reports.push(await probeExtension(name, seams));
	return reports;
}

/** Findings that mean an enabled extension cannot do its job. */
export function missingFindings(reports: readonly ExtensionReport[]): Finding[] {
	return reports.flatMap((report) => (report.enabled ? report.findings.filter((f) => f.severity === "missing") : []));
}

/**
 * The extensions with at least one hard requirement.
 *
 * The proactive session-start check uses this rather than the full table: only
 * these can produce a warning, so there is no reason to spend a session's
 * startup budget probing the rest.
 */
export function hardRequirementExtensions(): string[] {
	return Object.entries(REQUIREMENTS)
		.filter(([, spec]) => (spec.requires?.length ?? 0) > 0)
		.map(([name]) => name);
}
