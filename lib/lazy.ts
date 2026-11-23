/**
 * One async load, run at most once.
 *
 * A surface a command needs but registration does not — a browser page, a
 * review server, a screen — is imported through this: `get()` runs the loader
 * and remembers the value, and `peek()` answers the value already loaded, or
 * `undefined`, so a shutdown path never starts a load the session never used.
 *
 * A rejected load is not remembered. A transient failure can be retried, and a
 * caller that sees the error can ask again; the alternative would make one bad
 * import permanent for the process.
 *
 * State lives in this closure, not at module scope, because `lib/` is loaded
 * with isolated module caches and is value-only.
 *
 * `assertDeferredPresent` reads those deferrals back for the modules a session
 * will load later: a specifier whose file is gone — a module moved under a process
 * that started before the move — is one error at session start naming the file
 * that wrote it, instead of a tool call failing mid-turn.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A value loaded on first use, with a way to ask whether it is already here. */
export interface Lazy<T> {
	/** Load the value, or return the one already loaded; concurrent calls share one load. */
	get(): Promise<T>;
	/** The loaded value, or `undefined` before a load and after a failed one. */
	peek(): T | undefined;
}

export function lazy<T>(load: () => Promise<T>): Lazy<T> {
	let loaded = false;
	let value: T;
	let pending: Promise<T> | undefined;
	const get = (): Promise<T> => {
		if (loaded) return Promise.resolve(value);
		pending ??= load().then(
			(result) => {
				loaded = true;
				value = result;
				return result;
			},
			(error: unknown) => {
				pending = undefined;
				throw error;
			},
		);
		return pending;
	};
	return { get, peek: () => (loaded ? value : undefined) };
}

/**
 * The deferred specifiers one module's source names, in order and as written.
 *
 * Only a literal `import("…")` is read. A specifier built from a variable cannot
 * be checked before it runs, so it is skipped rather than guessed at: a guard that
 * reported a path the source never wrote would be worse than none.
 */
export function deferredSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	for (const match of source.matchAll(/\bimport\(\s*["'](\.[^"'\n]*)["']/g)) {
		const specifier = match[1];
		if (specifier !== undefined) specifiers.push(specifier);
	}
	return specifiers;
}

/** One specifier the tree does not have, with the file that wrote it and where it looked. */
interface MissingDeferral {
	file: string;
	specifier: string;
	dir: string;
}

/**
 * Throw once, naming each miss, when a module a session will defer to is not
 * where the source says it is.
 *
 * A read and a stat, never an import: the deferred module is still not evaluated at
 * start, so a session pays one source read and a few stats rather than a module,
 * and no entry's registration budget moves. `files` are relative to `base`, which
 * is the calling entry's `import.meta.url` — an entry names the files of its own
 * that write a `import(`, so the list is one a reader can check by eye.
 */
export function assertDeferredPresent(base: string, files: readonly string[]): void {
	const missing: MissingDeferral[] = [];
	for (const file of files) {
		const source = new URL(file, base);
		const text = readFileSync(fileURLToPath(source), "utf8");
		for (const specifier of deferredSpecifiers(text)) {
			const target = new URL(specifier, source);
			if (existsSync(fileURLToPath(target))) continue;
			missing.push({ file, specifier, dir: fileURLToPath(new URL(".", target)) });
		}
	}
	const first = missing[0];
	if (first === undefined) return;
	throw new Error(
		[
			`deferred module missing: ${first.file} names ${first.specifier}`,
			`  absent from ${first.dir}`,
			...missing.slice(1).map((miss) => `  also ${miss.file} names ${miss.specifier}, absent from ${miss.dir}`),
			"  the tree moved under this process: /reload, or start a new session",
		].join("\n"),
	);
}
