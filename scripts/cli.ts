/**
 * Shared command-line plumbing for the dev scripts (dev tooling).
 *
 * The two shot scripts parse the same flag set — output, width, scale, theme,
 * wait — and two more read a numeric flag, so the parsing, the validations, and
 * the usage epilogue live here instead of once per script. A script keeps its
 * own positional argument, its own extra flags, and its own defaults.
 */

/** What the shot scripts' shared flags parse to. */
export interface ShotArgs {
	/** The output path as given, or the caller's default; each script resolves it. */
	out: string;
	/** CSS viewport width, already rounded. */
	width: number;
	/** Device pixel ratio. */
	scale: number;
	/** Forced page theme; the page follows the system when absent. */
	theme?: "light" | "dark";
	/** How long to wait for the page to render, in milliseconds. */
	waitMs: number;
	/** Non-flag arguments, in order. */
	positional: string[];
	/** The caller's own value-flags, keyed as written (`"--root"`). */
	values: Record<string, string>;
	/** The caller's own bare flags that were given, e.g. `--share`. */
	flags: Set<string>;
}

export interface ShotArgOptions {
	/** Default for `-o`; the script resolves it. */
	out: string;
	/** Default for `--scale`: a page capture and a plan capture differ. */
	scale: number;
	/** The caller's own value-taking flags, e.g. `["--root", "--file"]`. */
	extraFlags?: readonly string[];
	/** The caller's own bare flags, which take no value, e.g. `["--share"]`. */
	extraBooleans?: readonly string[];
	/** Positionals accepted before one is an error; default is unlimited. */
	maxPositional?: number;
}

/**
 * Parse the shot flags. Throws a message the caller prints as usage: an empty
 * message for `-h`, and one starting with `--` for a flag that is wrong, which
 * the epilogue uses to decide whether the usage line adds anything.
 */
export function parseShotArgs(argv: string[], options: ShotArgOptions): ShotArgs {
	let out = options.out;
	let width = 1280;
	let scale = options.scale;
	let theme: "light" | "dark" | undefined;
	let waitMs = 8000;
	const positional: string[] = [];
	const values: Record<string, string> = {};
	const flags = new Set<string>();
	const extra = new Set(options.extraFlags ?? []);
	const booleans = new Set(options.extraBooleans ?? []);
	const maxPositional = options.maxPositional ?? Number.POSITIVE_INFINITY;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		const value = (): string => {
			const next = argv[++index];
			if (next === undefined) throw new Error(`${arg} needs a value`);
			return next;
		};
		if (arg === "-o" || arg === "--out") out = value();
		else if (arg === "--width") width = Number(value());
		else if (arg === "--scale") scale = Number(value());
		else if (arg === "--wait") waitMs = Number(value());
		else if (arg === "--theme") {
			const chosen = value();
			if (chosen !== "light" && chosen !== "dark") throw new Error("--theme must be light or dark");
			theme = chosen;
		} else if (arg === "-h" || arg === "--help") throw new Error("");
		else if (extra.has(arg)) values[arg] = value();
		else if (booleans.has(arg)) flags.add(arg);
		else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
		else if (positional.length >= maxPositional) throw new Error(`unexpected argument ${arg}`);
		else positional.push(arg);
	}
	if (!Number.isFinite(width) || width < 320) throw new Error("--width must be at least 320");
	if (!Number.isFinite(scale) || scale <= 0) throw new Error("--scale must be positive");
	if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error("--wait must not be negative");
	return { out, width: Math.round(width), scale, theme, waitMs, positional, values, flags };
}

/** A positive numeric `--flag value`, or `fallback` when it is absent or unusable. */
export function numberArg(args: string[], flag: string, fallback: number): number;
export function numberArg(args: string[], flag: string): number | undefined;
export function numberArg(args: string[], flag: string, fallback?: number): number | undefined {
	const index = args.indexOf(flag);
	if (index < 0) return fallback;
	const value = Number.parseInt(args[index + 1] ?? "", 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Run a script body, printing its message and, when it adds anything, the usage line. */
export function runCli(usage: string, main: () => Promise<void>): void {
	void main().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message || usage);
		if (message && !message.startsWith("--")) console.error(usage);
		process.exit(1);
	});
}
