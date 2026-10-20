/**
 * The watch runtime: session-scoped tailers, their matcher, and their state.
 *
 * A file watcher is polled on a clock that only calls the public {@link
 * WatchRuntime.tick}; a command watcher is event-driven and feeds both output
 * streams through the same line matcher. All long-lived state lives in this
 * closure, and `load` resets it for a new session. `shutdown` is idempotent and
 * kills every running command.
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { LineSplitter } from "../../lib/lines.ts";
import { defaultKillTree, defaultSpawn, type KillTreeFn, type SpawnFn, type SpawnedProcess } from "../../lib/spawn.ts";
import { DEFAULT_CONFIG, loadConfig, type WatchConfig } from "./config.ts";
import { sanitizeUntrustedLine } from "../../lib/format.ts";
import { compileRegex, sourceLabel } from "./format.ts";
import { createUiController, type UiController } from "./ui.ts";
import type { PendingMatch, WatchMatch, WatchRecord, WatchSource } from "./types.ts";

/** Largest slice read from a file per tick. */
const MAX_CHUNK = 1024 * 1024;
/** Grace period before a stopped command is escalated to SIGKILL. */
const KILL_GRACE_MS = 2000;

/** Internal watcher state: the public record plus non-serializable fields. */
interface Internal {
	id: string;
	label: string;
	source: WatchSource;
	pattern: string;
	exclude: string[];
	caseSensitive: boolean;
	wake: boolean;
	fromStart: boolean;
	status: WatchRecord["status"];
	startedAt: number;
	endedAt?: number;
	error?: string;
	linesRead: number;
	matchCount: number;
	lastMatchAt?: number;
	pid?: number;
	exitCode?: number | null;
	signal?: string | null;
	regex: RegExp;
	excludes: RegExp[];
	offset: number;
	lines: LineSplitter;
	rawLines: string[];
	matches: WatchMatch[];
	child?: SpawnedProcess;
	killTimer?: ReturnType<typeof setTimeout>;
	notified: boolean;
	seq: number;
}

export interface AddWatchOptions {
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

export interface WatchRuntime {
	readonly config: WatchConfig;
	effectiveCwd(ctx: ExtensionContext): string;
	load(ctx: ExtensionContext): void;
	add(options: AddWatchOptions, ctx: ExtensionContext): WatchRecord;
	list(): WatchRecord[];
	get(id: string): WatchRecord | undefined;
	matches(id: string, lines?: number): { watch: WatchRecord; lines: string[]; truncated: boolean } | undefined;
	logs(id: string, lines?: number): { watch: WatchRecord; lines: string[]; truncated: boolean } | undefined;
	stop(id: string): boolean;
	clear(id?: string, all?: boolean): { cleared: number; refused?: string };
	pendingMatches(): PendingMatch[];
	markReported(items: PendingMatch[]): void;
	runningCount(): number;
	unseenCount(): number;
	setStatus(ctx?: ExtensionContext): void;
	tick(): void;
	shutdown(): Promise<void>;
	onMatch: ((matches: PendingMatch[]) => void) | undefined;
}

export interface WatchRuntimeOptions {
	spawn?: SpawnFn;
	killTree?: KillTreeFn;
	now?: () => number;
	/** Fixed config; when absent, `load` reads `ctx.cwd`. */
	config?: WatchConfig;
	/** When false, never create a real interval; tests call `tick()` directly. */
	autoClock?: boolean;
	/** Grace before SIGTERM escalates to SIGKILL; default {@link KILL_GRACE_MS}. */
	killGraceMs?: number;
}

export function createWatchRuntime(options: WatchRuntimeOptions = {}): WatchRuntime {
	const spawnFn = options.spawn ?? defaultSpawn;
	const killTree = options.killTree ?? defaultKillTree;
	const now = options.now ?? (() => Date.now());
	const fixedConfig = options.config;
	const autoClock = options.autoClock ?? true;
	const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;

	let config: WatchConfig = fixedConfig ?? DEFAULT_CONFIG;
	const watches = new Map<string, Internal>();
	let counter = 0;
	let disposed = false;
	let clock: ReturnType<typeof setInterval> | undefined;
	let onMatchHandler: ((matches: PendingMatch[]) => void) | undefined;

	const record = (w: Internal): WatchRecord => ({
		id: w.id,
		label: w.label,
		source: w.source,
		pattern: w.pattern,
		exclude: [...w.exclude],
		caseSensitive: w.caseSensitive,
		wake: w.wake,
		fromStart: w.fromStart,
		status: w.status,
		startedAt: w.startedAt,
		...(w.endedAt !== undefined ? { endedAt: w.endedAt } : {}),
		...(w.error !== undefined ? { error: w.error } : {}),
		linesRead: w.linesRead,
		matchCount: w.matchCount,
		...(w.lastMatchAt !== undefined ? { lastMatchAt: w.lastMatchAt } : {}),
		...(w.pid !== undefined ? { pid: w.pid } : {}),
		...(w.exitCode !== undefined ? { exitCode: w.exitCode } : {}),
		...(w.signal !== undefined ? { signal: w.signal } : {}),
	});

	const list = (): WatchRecord[] => [...watches.values()].map(record);

	const runningCount = (): number => {
		let count = 0;
		for (const w of watches.values()) if (w.status === "running") count++;
		return count;
	};

	const unseenCount = (): number => {
		let count = 0;
		for (const w of watches.values()) for (const m of w.matches) if (!m.seen) count++;
		return count;
	};

	const ui: UiController = createUiController({
		getWatches: () => list(),
		getUnseenMatches: () => unseenCount(),
		getConfig: () => config,
	});

	const stopClock = (): void => {
		if (clock) {
			clearInterval(clock);
			clock = undefined;
		}
	};

	const ensureClock = (): void => {
		if (disposed || !autoClock || clock) return;
		clock = setInterval(() => tick(), config.pollMs);
		clock.unref?.();
	};

	const pendingMatches = (): PendingMatch[] => {
		const out: PendingMatch[] = [];
		for (const w of watches.values()) {
			for (const m of w.matches) {
				if (m.seen) continue;
				out.push({
					watcherId: w.id,
					label: w.label || sourceLabel(record(w)),
					seq: m.seq,
					line: m.line,
					at: m.at,
				});
			}
		}
		return out.sort((a, b) => a.at - b.at || a.seq - b.seq);
	};

	const fireOnMatch = (): void => {
		const pending = pendingMatches();
		if (pending.length === 0) return;
		try {
			onMatchHandler?.(pending);
		} catch {
			// Waking is best-effort; the matches remain pending for the next turn.
		}
	};

	const emit = (w: Internal, rawLine: string, time: number): boolean => {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		w.linesRead++;
		w.rawLines.push(line);
		if (w.rawLines.length > config.maxLogLines) {
			w.rawLines.splice(0, w.rawLines.length - config.maxLogLines);
		}
		for (const exclude of w.excludes) if (exclude.test(line)) return false;
		if (!w.regex.test(line)) return false;

		const clean = sanitizeUntrustedLine(line);
		w.matches.push({ seq: ++w.seq, line: clean, at: time, seen: false });
		if (w.matches.length > config.maxMatches) {
			w.matches.splice(0, w.matches.length - config.maxMatches);
		}
		w.matchCount++;
		w.lastMatchAt = time;
		if (!w.notified) {
			w.notified = true;
			ui.notifyMatch(record(w), clean);
		}
		ui.paint();
		return true;
	};

	const consume = (w: Internal, chunk: Buffer, time: number): void => {
		let matched = false;
		for (const line of w.lines.push(chunk)) {
			if (emit(w, line, time)) matched = true;
		}
		if (matched && w.wake) fireOnMatch();
	};

	/** A source that ended mid-line still reports that line. */
	const flushPending = (w: Internal, time: number): void => {
		for (const line of w.lines.flush()) emit(w, line, time);
	};

	const clearKillTimer = (w: Internal): void => {
		if (w.killTimer) {
			clearTimeout(w.killTimer);
			w.killTimer = undefined;
		}
	};

	const killChild = (w: Internal, signal: "SIGTERM" | "SIGKILL"): void => {
		const pid = w.pid;
		try {
			if (pid !== undefined) killTree(pid, signal, signal === "SIGKILL");
			else w.child?.kill(signal);
		} catch {
			// Best-effort: the child may already be gone.
		}
	};

	/** SIGTERM a command, escalating to SIGKILL when it has not closed in time. */
	const terminateChild = (w: Internal): void => {
		clearKillTimer(w);
		killChild(w, "SIGTERM");
		if (w.pid === undefined && !w.child) return;
		w.killTimer = setTimeout(() => {
			w.killTimer = undefined;
			if (w.child) killChild(w, "SIGKILL");
		}, killGraceMs);
		w.killTimer.unref?.();
	};

	/** Resolve when every command has closed, or after `ms`, whichever comes first. */
	const waitForChildren = (watches: Internal[], ms: number): Promise<void> => {
		const alive = watches.filter((w) => w.child !== undefined);
		if (alive.length === 0) return Promise.resolve();
		return new Promise((resolve) => {
			let remaining = alive.length;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const settle = (): void => {
				if (--remaining > 0) return;
				if (timer !== undefined) clearTimeout(timer);
				resolve();
			};
			for (const w of alive) {
				let done = false;
				const once = (): void => {
					if (done) return;
					done = true;
					settle();
				};
				w.child?.on("close", once);
				w.child?.on("error", once);
			}
			timer = setTimeout(resolve, ms);
			timer.unref?.();
		});
	};

	const pollFile = (w: Internal, time: number): void => {
		const path = w.source.path;
		if (!path) return;
		let size: number;
		try {
			size = statSync(path).size;
		} catch {
			// A rotated-away file is tolerated; a later tick picks up its replacement.
			return;
		}
		if (size < w.offset) {
			w.offset = 0;
			w.lines.reset();
		}
		if (w.offset >= size) return;

		const length = Math.min(MAX_CHUNK, size - w.offset);
		const buffer = Buffer.allocUnsafe(length);
		let fd: number | undefined;
		try {
			fd = openSync(path, "r");
			const read = readSync(fd, buffer, 0, length, w.offset);
			w.offset += read;
			consume(w, buffer.subarray(0, read), time);
		} catch {
			// The path can vanish or change type between stat and read (rotation, a
			// replacement); skip this tick and pick it up next time.
		} finally {
			if (fd !== undefined) {
				try {
					closeSync(fd);
				} catch {
					// Nothing to release.
				}
			}
		}
	};

	const startCommand = (w: Internal): void => {
		let child: SpawnedProcess;
		try {
			child = spawnFn(w.source.command ?? "", { cwd: w.source.cwd ?? process.cwd() });
		} catch (error) {
			w.status = "error";
			w.error = (error as Error).message;
			w.endedAt = now();
			return;
		}
		w.child = child;
		w.pid = child.pid;
		const onData = (chunk: Buffer): void => consume(w, chunk, now());
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.on("close", (code, signal) => {
			clearKillTimer(w);
			w.child = undefined;
			if (w.status !== "running") return;
			flushPending(w, now());
			w.status = "exited";
			w.exitCode = code;
			w.signal = signal;
			w.endedAt = now();
			ui.paint();
			if (runningCount() === 0) stopClock();
		});
		child.on("error", (error) => {
			clearKillTimer(w);
			w.child = undefined;
			if (w.status !== "running") return;
			w.status = "error";
			w.error = error.message;
			w.endedAt = now();
			ui.paint();
			if (runningCount() === 0) stopClock();
		});
	};

	const tick = (): void => {
		if (disposed) return;
		const time = now();
		for (const w of watches.values()) {
			if (w.source.kind === "file" && w.status === "running") pollFile(w, time);
		}
		ui.paint();
		if (runningCount() === 0) stopClock();
	};

	const add = (opts: AddWatchOptions, ctx: ExtensionContext): WatchRecord => {
		if (!config.enabled) throw new Error("watch is disabled.");
		if (watches.size >= config.maxWatchers) {
			throw new Error(`at most ${config.maxWatchers} watchers; stop one first.`);
		}
		const base = resolveEffectiveCwd(ctx.cwd);
		const source: WatchSource = opts.path
			? { kind: "file", path: isAbsolute(opts.path) ? opts.path : resolve(base, opts.path) }
			: {
					kind: "command",
					command: (opts.command ?? "").trim(),
					cwd: opts.cwd ? (isAbsolute(opts.cwd) ? opts.cwd : resolve(base, opts.cwd)) : base,
				};
		if (source.kind === "file") {
			let info: ReturnType<typeof statSync>;
			try {
				info = statSync(source.path ?? "");
			} catch {
				throw new Error(`file not found: ${source.path}`);
			}
			if (!info.isFile()) throw new Error(`not a regular file: ${source.path}`);
		}
		const caseSensitive = opts.caseSensitive ?? false;
		const regex = compileRegex(opts.pattern, caseSensitive);
		const excludes = (opts.exclude ?? []).map((pattern) => compileRegex(pattern, caseSensitive));
		const time = now();
		const fromStart = opts.fromStart ?? false;
		let offset = 0;
		if (source.kind === "file" && !fromStart) {
			try {
				offset = statSync(source.path ?? "").size;
			} catch {
				offset = 0;
			}
		}
		const w: Internal = {
			id: `w${++counter}`,
			label: opts.label ?? "",
			source,
			pattern: opts.pattern,
			exclude: opts.exclude ?? [],
			caseSensitive,
			wake: opts.wake ?? config.wakeOnMatch,
			fromStart,
			status: "running",
			startedAt: time,
			linesRead: 0,
			matchCount: 0,
			regex,
			excludes,
			offset,
			lines: new LineSplitter(),
			rawLines: [],
			matches: [],
			notified: false,
			seq: 0,
		};
		watches.set(w.id, w);
		if (source.kind === "command") startCommand(w);
		ensureClock();
		ui.paint();
		return record(w);
	};

	const get = (id: string): WatchRecord | undefined => {
		const w = watches.get(id);
		return w ? record(w) : undefined;
	};

	const tail = (
		id: string,
		lines: number | undefined,
		pick: (w: Internal) => string[],
	): { watch: WatchRecord; lines: string[]; truncated: boolean } | undefined => {
		const w = watches.get(id);
		if (!w) return undefined;
		const all = pick(w);
		const count = lines ?? config.matchLines;
		const tailed = all.slice(Math.max(0, all.length - count));
		return { watch: record(w), lines: tailed, truncated: all.length > tailed.length };
	};

	const matches = (id: string, lines?: number) => tail(id, lines, (w) => w.matches.map((m) => m.line));
	const logs = (id: string, lines?: number) =>
		tail(id, lines, (w) => w.rawLines.map((line) => sanitizeUntrustedLine(line)));

	const stop = (id: string): boolean => {
		const w = watches.get(id);
		if (!w || w.status !== "running") return false;
		flushPending(w, now());
		terminateChild(w);
		w.status = "stopped";
		w.endedAt = now();
		ui.paint();
		if (runningCount() === 0) stopClock();
		return true;
	};

	const clear = (id?: string, all = false): { cleared: number; refused?: string } => {
		if (id) {
			const w = watches.get(id);
			if (!w) return { cleared: 0 };
			if (w.status === "running" && !all) {
				return { cleared: 0, refused: `watcher "${id}" is running; pass all:true to stop it.` };
			}
			if (w.status === "running") stop(id);
			watches.delete(id);
			ui.paint();
			return { cleared: 1 };
		}
		let cleared = 0;
		for (const [key, w] of [...watches]) {
			if (w.status === "running" && !all) continue;
			if (w.status === "running") stop(key);
			watches.delete(key);
			cleared++;
		}
		if (cleared > 0) ui.paint();
		return { cleared };
	};

	const markReported = (items: PendingMatch[]): void => {
		const byWatcher = new Map<string, Set<number>>();
		for (const item of items) {
			const set = byWatcher.get(item.watcherId) ?? new Set<number>();
			set.add(item.seq);
			byWatcher.set(item.watcherId, set);
		}
		for (const [id, seqs] of byWatcher) {
			const w = watches.get(id);
			if (!w) continue;
			for (const match of w.matches) if (seqs.has(match.seq)) match.seen = true;
			if (!w.matches.some((match) => !match.seen)) w.notified = false;
		}
		ui.paint();
	};

	const load = (ctx: ExtensionContext): void => {
		disposed = false;
		stopClock();
		for (const w of watches.values()) {
			if (w.status !== "running") continue;
			w.status = "stopped";
			clearKillTimer(w);
			killChild(w, "SIGKILL");
			w.child = undefined;
		}
		watches.clear();
		counter = 0;
		config = fixedConfig ?? loadConfig(ctx.cwd);
		ui.attach(ctx);
		ui.paint();
	};

	const shutdown = async (): Promise<void> => {
		disposed = true;
		stopClock();
		const running = [...watches.values()].filter((w) => w.status === "running");
		for (const w of running) {
			flushPending(w, now());
			w.status = "stopped";
			w.endedAt = now();
			clearKillTimer(w);
			killChild(w, "SIGTERM");
		}
		await waitForChildren(running, killGraceMs);
		for (const w of running) {
			clearKillTimer(w);
			if (w.child) killChild(w, "SIGKILL");
		}
		watches.clear();
		ui.detach();
	};

	return {
		get config() {
			return config;
		},
		effectiveCwd: (ctx) => resolveEffectiveCwd(ctx.cwd),
		load,
		add,
		list,
		get,
		matches,
		logs,
		stop,
		clear,
		pendingMatches,
		markReported,
		runningCount,
		unseenCount,
		setStatus: (ctx) => ui.setStatus(ctx),
		tick,
		shutdown,
		get onMatch() {
			return onMatchHandler;
		},
		set onMatch(handler) {
			onMatchHandler = handler;
		},
	};
}
