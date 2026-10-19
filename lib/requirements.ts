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
import { configSection, configValueAt, type JsonReadResult, SHARED_CONFIG_FILE } from "./config.ts";
import type { WebSearchProviderEvent } from "./events.ts";
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

/**
 * The notification delivery bytefly is configured for.
 *
 * The configured method belongs to the notify capability, so it arrives through
 * {@link ProbeSeams.notify}; whether this host can honour it is decided here.
 */
export interface NotifyCheck {
	kind: "notify";
	enables: string;
	hint: string;
}

/**
 * The resolved `web_search` provider, as `web-access` publishes it.
 *
 * The provider list, each provider's configuration test, and the `auto` rule live
 * in `web-access`, so the check reads a published summary rather than rebuilding
 * any of it here; the payload never carries the key itself.
 */
export interface ProviderCheck {
	kind: "provider";
	enables: string;
	hint: string;
}

/**
 * A config switch whose "off" value trades a safety net away.
 *
 * A prerequisite table can already say "this is missing"; this says "you turned
 * this protection off", which is the other way an extension ends up degraded
 * without anything being absent. The value is read from `bytefly.json` (global,
 * then project, project wins), so the check needs no extension to publish
 * anything — the switch is the whole fact.
 */
export interface SafetyCheck {
	kind: "safety";
	/** The `bytefly.json` section that owns the switch. */
	section: string;
	/** The key path inside that section. */
	keyPath: readonly string[];
	/** The value that means the net is off. */
	off: boolean;
	/** What the switch protects, for the passing case. */
	enables: string;
	/** What is true once it is off, for the degraded case. */
	disabled: string;
	hint: string;
}

/**
 * A fact that ages: something checked by hand on a date, which is still worth
 * trusting only for a while. The date arrives through a seam because `lib/` cannot
 * import the extension that owns the record.
 */
export interface AgeCheck {
	kind: "age";
	/** What was verified, phrased for the report, e.g. `the built-in rate tables`. */
	what: string;
	/** Days after which the record counts as stale. */
	maxAgeDays: number;
	enables: string;
	hint: string;
}

export type RequirementCheck =
	| BinaryCheck
	| ModuleCheck
	| StateCheck
	| InvocationCheck
	| NotifyCheck
	| ProviderCheck
	| SafetyCheck
	| AgeCheck;

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
		optional: [
			{
				kind: "safety",
				section: "worktree",
				keyPath: ["guard", "blockPowershell"],
				off: false,
				enables: "`powershell` is refused while the session is isolated",
				disabled: "`powershell` runs unguarded, with its relative paths against the main checkout",
				hint: "set `worktree.guard.blockPowershell` back to true, or use `bash`, which is re-rooted and guarded.",
			},
		],
		notes: [
			"`.worktreeinclude` symlinks need symlink support (Windows Developer Mode).",
			"Your own `!` shell is not re-rooted or guarded; only the model's own tools are.",
			"Commands whose git behavior cannot be verified pass through unless `worktree.guard.blockUnparsableCommands` is set.",
		],
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
			"Windows: a job cannot be detached (`detached: true` is refused and `job.detachedByDefault` is inert), and a job reported only after its process is gone stays `unknown` — there is no shell `EXIT` trap.",
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
		optional: [
			{ kind: "module", name: "unpdf", enables: "PDF text extraction in `web_fetch`", hint: pdfGuidance() },
			{
				kind: "provider",
				enables: "`web_search` through the configured provider",
				hint: "set `web-access.search.provider` and its `endpoint`/`apiKeyEnv`/`apiKey` in bytefly.json, or export the key variable.",
			},
		],
	},
	"file-browse": {
		optional: [gitCheck("the branch chip and the diff view")],
		notes: ["The default-browser opener (`open` / `xdg-open` / `cmd`) is best-effort; the URL is printed either way."],
	},
	document: {},
	"file-open": {
		notes: [
			"The `/open` command and its notification need an interactive UI; the `open_path` tool works without one.",
			"Launching the OS handler is best-effort: a launcher that fails to start, or exits non-zero on macOS and Linux, is reported; Windows `explorer` can exit non-zero after a successful open.",
			"The tool result names the target even when the launch fails.",
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
		optional: [
			{
				kind: "age",
				what: "the built-in DeepSeek rate tables",
				maxAgeDays: 90,
				enables: "the footer's cost total tracks the published tariff",
				hint: "re-check https://api-docs.deepseek.com/quick_start/pricing against `footer/price/config.ts`, then update `PRICE_VERIFIED_AT`.",
			},
			{
				kind: "notify",
				enables: "the configured notification delivery",
				hint: 'set "notify.method" to "auto" in bytefly.json, or choose one this host can deliver.',
			},
		],
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
	/** The notify capability's configured delivery, or absent when it is not in play. */
	notify?: () => { enabled: boolean; method: string } | undefined;
	/** Whether stdout is a terminal, which the OSC methods need; defaults to true. */
	isTTY?: boolean;
	/** The search provider `web-access` resolved for this session, when it published one. */
	searchProvider?: () => WebSearchProviderEvent | undefined;
	/** Read an environment variable; defaults to the process environment. */
	env?: (name: string) => string | undefined;
	/** Probe a URL's reachability; only called when `refresh` is true. */
	reach?: (url: string) => Promise<{ ok: boolean; error?: string }>;
	/** True when the caller asked for an explicit refresh, which is when a probe may touch the network. */
	refresh?: boolean;
	/** The day a hand-checked record was verified, as `YYYY-MM-DD`, when the extension records one. */
	priceVerifiedAt?: () => string | undefined;
	/** The clock the age check reads; defaults to the process clock. */
	now?: () => number;
}

/**
 * Whether `method` can deliver on this host.
 *
 * `auto` inspects the environment itself, so it always can; the OSC methods need
 * a terminal to write to; the rest are platform-specific. An unknown id counts
 * as deliverable because bytefly's own loader already rejects one.
 */
export function canDeliver(method: string, env: { platform: NodeJS.Platform; isTTY: boolean }): boolean {
	switch (method) {
		case "auto":
			return true;
		case "osc777":
		case "osc99":
			return env.isTTY;
		case "toast":
			return env.platform === "win32";
		case "osascript":
			return env.platform === "darwin";
		case "notify-send":
			return env.platform === "linux";
		default:
			return true;
	}
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

/**
 * The findings for the `web_search` provider check.
 *
 * Up to three separate facts, because they have three different fixes: which
 * provider is in use, whether its key variable is set, and — only on an explicit
 * refresh — whether its configurable endpoint answers.
 */
async function providerFindings(
	extension: string,
	check: ProviderCheck,
	failSeverity: FindingSeverity,
	seams: ProbeSeams,
): Promise<Finding[]> {
	const facts = seams.searchProvider?.();
	if (!facts) {
		return [
			{
				extension,
				check: "web-access.search.provider",
				severity: "info",
				detail: "web-access has not reported a search provider in this session",
			},
		];
	}

	const findings: Finding[] = [];
	findings.push({
		extension,
		check: "web-access.search.provider",
		severity: facts.configured ? "ok" : failSeverity,
		detail: facts.configured
			? `resolved to ${facts.provider} (${facts.reason})`
			: `resolved to ${facts.provider} (${facts.reason}), which is not configured — ${check.enables}`,
		...(!facts.configured ? { hint: check.hint } : {}),
	});

	const env = seams.env ?? ((name: string) => process.env[name]);
	if (facts.apiKeyEnv && !facts.keyConfigured) {
		const present = (env(facts.apiKeyEnv) ?? "").trim() !== "";
		findings.push({
			extension,
			check: facts.apiKeyEnv,
			severity: present ? "ok" : failSeverity,
			detail: present
				? `${facts.apiKeyEnv} is set — the ${facts.provider} API key`
				: `the API key for ${facts.provider} is missing — ${facts.apiKeyEnv} is not set`,
			...(present ? {} : { hint: `export ${facts.apiKeyEnv}, or set web-access.search.apiKey in bytefly.json.` }),
		});
	}

	// Reachability is the one probe that touches the network, so it runs only when
	// the caller asked for an explicit refresh.
	if (seams.refresh === true && facts.endpoint !== null) {
		const reach = seams.reach;
		if (!reach) {
			findings.push({
				extension,
				check: facts.endpoint,
				severity: "info",
				detail: "no reachability probe is available in this context",
			});
		} else {
			const outcome = await reach(facts.endpoint).catch((error: unknown) => ({
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			}));
			findings.push({
				extension,
				check: facts.endpoint,
				severity: outcome.ok ? "ok" : failSeverity,
				detail: outcome.ok
					? `${facts.endpoint} answered`
					: `${facts.endpoint} did not answer (${outcome.error ?? "no response"})`,
				...(outcome.ok
					? {}
					: { hint: "check web-access.search.endpoint in bytefly.json, or that the SearXNG server is running." }),
			});
		}
	}

	return findings;
}

/**
 * The effective value of one config leaf, global then project. An absent or
 * unparseable document contributes nothing — the malformed-JSON check owns that
 * case — so this returns `undefined` rather than a guess.
 */
function configLeaf(check: SafetyCheck, seams: ProbeSeams): { value: unknown; path: string } | undefined {
	const candidates = [
		join(seams.dirs.agentDir, SHARED_CONFIG_FILE),
		join(seams.dirs.cwd, seams.dirs.configDirName, SHARED_CONFIG_FILE),
	];
	let found: { value: unknown; path: string } | undefined;
	for (const path of candidates) {
		const result = seams.readJson(path);
		if (result.state !== "ok") continue;
		const section = configSection(result.value, check.section);
		const value = configValueAt(section, check.keyPath);
		if (value !== undefined) found = { value, path };
	}
	return found;
}

/** The findings for a switch whose off value trades a safety net away. */
function safetyFindings(
	extension: string,
	check: SafetyCheck,
	failSeverity: FindingSeverity,
	seams: ProbeSeams,
): Finding[] {
	const leaf = configLeaf(check, seams);
	const label = [check.section, ...check.keyPath].join(".");
	if (leaf?.value === check.off) {
		return [
			{
				extension,
				check: label,
				severity: failSeverity,
				detail: `is ${String(check.off)} in ${leaf.path} — ${check.disabled}`,
				hint: check.hint,
			},
		];
	}
	return [{ extension, check: label, severity: "ok", detail: check.enables }];
}

/**
 * Whole days between an ISO `YYYY-MM-DD` date and `now`, or undefined for a date
 * that does not parse or does not exist on the calendar.
 *
 * A date up to a day in the future reads as zero days old: a record made in a
 * timezone ahead of UTC is not a typo, and reporting it as missing would hide a
 * fresh record. Anything further ahead is a typo, so it is not a date.
 */
export function ageInDays(date: string, now: number): number | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
	const stamp = Date.parse(`${date}T00:00:00Z`);
	if (!Number.isFinite(stamp)) return undefined;
	// `Date.parse` accepts 2026-02-31 by rolling it into March; reject the roll.
	if (new Date(stamp).toISOString().slice(0, 10) !== date) return undefined;
	const days = Math.floor((now - stamp) / 86_400_000);
	if (days >= 0) return days;
	// One day of skew is a timezone, not a mistake.
	return days >= -1 ? 0 : undefined;
}

/** The findings for a fact that ages. */
function ageFindings(extension: string, check: AgeCheck, failSeverity: FindingSeverity, seams: ProbeSeams): Finding[] {
	const label = check.what;
	const date = seams.priceVerifiedAt?.();
	const age = date === undefined ? undefined : ageInDays(date, (seams.now ?? Date.now)());
	if (date === undefined || age === undefined) {
		return [
			{
				extension,
				check: label,
				severity: "info",
				detail: `no verification date is recorded for ${label}`,
			},
		];
	}
	const days = `${age} day${age === 1 ? "" : "s"} ago`;
	if (age <= check.maxAgeDays) {
		return [{ extension, check: label, severity: "ok", detail: `${label} last checked ${days}` }];
	}
	return [
		{
			extension,
			check: label,
			severity: failSeverity,
			detail: `${label} were last checked ${days}, beyond the ${check.maxAgeDays}-day window — ${check.enables}`,
			hint: check.hint,
		},
	];
}

/** Run one check. `failSeverity` comes from which list the check sits in. */
async function runCheck(
	extension: string,
	check: RequirementCheck,
	failSeverity: FindingSeverity,
	seams: ProbeSeams,
): Promise<Finding[]> {
	switch (check.kind) {
		case "binary": {
			const invocation = check.invocation?.() ?? {
				command: check.name,
				args: [...(check.probeArgs ?? ["--version"])],
			};
			const code = await probeCode(invocation, seams);
			return [
				code === 0
					? { extension, check: check.name, severity: "ok", detail: check.enables }
					: {
							extension,
							check: check.name,
							severity: failSeverity,
							detail: `not found on PATH — ${check.enables}`,
							hint: check.hint,
						},
			];
		}
		case "module": {
			const load = seams.loadModule ?? defaultLoadModule;
			try {
				await load(check.name);
			} catch {
				return [
					{
						extension,
						check: check.name,
						severity: failSeverity,
						detail: `not installed — ${check.enables}`,
						hint: check.hint,
					},
				];
			}
			return [{ extension, check: check.name, severity: "ok", detail: check.enables }];
		}
		case "state": {
			const path = join(scopeDir(check.scope, seams.dirs), check.file);
			const result = seams.readJson(path);
			if (result.state === "ok") return [{ extension, check: path, severity: "ok", detail: check.enables }];
			if (result.state === "absent") {
				return [
					{
						extension,
						check: path,
						severity: failSeverity,
						detail: `missing — ${check.enables}`,
						hint: check.hint,
					},
				];
			}
			return [
				{
					extension,
					check: path,
					severity: failSeverity,
					detail: `unreadable (${result.error}) — ${check.enables}`,
					hint: check.hint,
				},
			];
		}
		case "invocation": {
			const invocation = seams.invocation?.() ?? getPiInvocation(["--version"]);
			// Reusing the running interpreter cannot fail: the process is running.
			const code = invocation.command === process.execPath ? 0 : await probeCode(invocation, seams);
			return [
				code === 0
					? { extension, check: invocation.command, severity: "ok", detail: check.enables }
					: {
							extension,
							check: invocation.command,
							severity: failSeverity,
							detail: `cannot be run — ${check.enables}`,
							hint: check.hint,
						},
			];
		}
		case "notify": {
			const notify = seams.notify?.();
			if (!notify?.enabled) {
				return [{ extension, check: "notify.method", severity: "ok", detail: "notifications are off" }];
			}
			const env = { platform: seams.platform, isTTY: seams.isTTY ?? true };
			if (canDeliver(notify.method, env)) {
				return [
					{
						extension,
						check: "notify.method",
						severity: "ok",
						detail:
							notify.method === "auto"
								? "auto picks a route from the environment"
								: `"${notify.method}" delivers on ${seams.platform}`,
					},
				];
			}
			return [
				{
					extension,
					check: "notify.method",
					severity: failSeverity,
					detail: `"${notify.method}" cannot deliver on ${seams.platform} — ${check.enables}`,
					hint: check.hint,
				},
			];
		}
		case "provider":
			return providerFindings(extension, check, failSeverity, seams);
		case "safety":
			return safetyFindings(extension, check, failSeverity, seams);
		case "age":
			return ageFindings(extension, check, failSeverity, seams);
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
	for (const check of spec.requires ?? []) findings.push(...(await runCheck(extension, check, "missing", seams)));
	for (const check of spec.optional ?? []) findings.push(...(await runCheck(extension, check, "degraded", seams)));
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
