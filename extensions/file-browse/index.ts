/**
 * file-browse — view the working directory in a browser.
 *
 * Registers the read-only `/browse` command. It starts a `node:http` server
 * bound to 127.0.0.1, rooted at the effective cwd, and opens the default
 * browser at a two-pane tree browser. The page follows the session's root: a
 * `worktree:changed` re-roots it on the tree the session now works in, and the
 * open page reloads onto it. No tool is registered; the server is closed on
 * `session_shutdown`, by `/browse stop`, and once its last page has been gone
 * for the idle grace — a closed window is not a running server.
 *
 * Load with:  pi --extension ./extensions/file-browse
 */

import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled, resolveEffectiveCwd } from "../../lib/env.ts";
import type { openInBrowser } from "../../lib/browser.ts";
import type { ServeConfig } from "./config/config.ts";
import type { FileServer, RootReaders } from "./transport/server.ts";

export interface FileBrowserDeps {
	/** Override the server factory (tests). */
	createServer?: typeof import("./transport/server.ts").createFileServer;
	/** Override the browser opener (tests). */
	open?: typeof openInBrowser;
}

interface RunningServer {
	server: FileServer;
	/** The context of the command that started it, used to clear the chip later. */
	ctx: ExtensionContext;
	/** The config the page was opened with; a re-root keeps it. */
	config: ServeConfig;
	/** The checkout the session worked in when the page started, realpathed. */
	base: string;
	/** Drops the worktree listener; the subscription lives as long as the page. */
	off: () => void;
}

/** The real path of `path`, or the path itself when it cannot be resolved. */
function realOrSelf(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return path;
	}
}

/**
 * The session's root as the page serves it, canonicalized.
 *
 * A checkout reached through a symlink — `/tmp` on macOS is `/private/tmp` — must be resolved
 * before a subpath is matched against it: the containment check compares real paths, so a raw
 * root and a realpath'd candidate read as an escape and the page is refused.
 */
function baseOf(ctx: ExtensionContext): string {
	return realOrSelf(resolveEffectiveCwd(ctx.cwd));
}

export default function fileBrowser(pi: ExtensionAPI, deps: FileBrowserDeps = {}): void {
	if (!isExtensionEnabled("file-browse")) return;
	let running: RunningServer | undefined;
	/** The session this page serves as; the mount lands on its one server. */
	let sessionId = "";

	const stop = async (): Promise<boolean> => {
		const current = running;
		if (!current) return false;
		running = undefined;
		current.off();
		await current.server.close();
		return true;
	};

	/**
	 * Give the prefix back once the page that was its only reader has gone: nothing is
	 * left to serve. `/browse` starts it again on the session's port.
	 */
	const stopWhenPageLeft = async (): Promise<void> => {
		const current = running;
		if (!current) return;
		if (await stop()) current.ctx.ui.notify("browse: stopped — the last page was closed", "info");
	};

	type ResolvedRoot = { root: string; config: ServeConfig };

	/** The folder `/browse [path]` names, or undefined after telling the user why. */
	const resolveRoot = async (target: string, cwd: string, ctx: ExtensionContext): Promise<ResolvedRoot | undefined> => {
		const { loadConfig } = await import("./config/config.ts");
		const config = loadConfig(cwd);
		let root = cwd;
		if (target) {
			const { HttpError, resolveRequestPath } = await import("./files/paths.ts");
			try {
				root = await resolveRequestPath(cwd, target);
			} catch (error) {
				const message = error instanceof HttpError ? error.message : String(error);
				ctx.ui.notify(`browse: ${message}`, "error");
				return undefined;
			}
			const info = await stat(root).catch(() => undefined);
			if (!info?.isDirectory()) {
				ctx.ui.notify(`browse: ${target} is not a folder inside the working directory`, "error");
				return undefined;
			}
		}
		return { root, config };
	};

	/**
	 * Put the page in front of the user, unless the project asked to stay headless.
	 *
	 * Every `/browse` opens it, including one that finds the page already served: the
	 * command's job is showing the page, and a URL printed over a running server leaves
	 * the user to paste it.
	 */
	const openPage = async (url: string, config: ServeConfig): Promise<void> => {
		if (!config.autoOpen) return;
		const open = deps.open ?? (await import("../../lib/browser.ts")).openInBrowser;
		open(url);
	};

	/** The page's read-only git readers for one root; a re-root rebuilds them. */
	const readersFor = async (root: string, config: ServeConfig): Promise<RootReaders> => {
		const { createGitDiff, createGitStatus } = await import("./git/git.ts");
		return {
			git: createGitStatus(pi, root),
			diff: createGitDiff(pi, root, {
				context: config.diffContext,
				maxLines: config.maxDiffLines,
				maxFileBytes: config.maxFileBytes,
				maxTextLines: config.maxTextLines,
			}),
		};
	};

	/**
	 * Serve the tree the session now works in, from the page's own URL.
	 *
	 * A worktree switch moves the session's root, and the page follows what a fresh
	 * `/browse` would serve — `resolveEffectiveCwd` is the one rule, so the event and the
	 * command cannot disagree. A page started on a subfolder keeps that subfolder under the
	 * new tree when it is there, and falls back to the new root when it is not. The open
	 * page reloads onto it; the URL, port, and prefix stay the session's.
	 */
	const follow = (): void => {
		const current = running;
		if (!current) return;
		const nextBase = baseOf(current.ctx);
		// Nothing moved: an event that repeats the tree already served costs no reads.
		if (nextBase === current.base) return;
		void reRoot(current, nextBase);
	};

	/** The asynchronous half of a follow: resolve the root the page should serve now. */
	const reRoot = async (current: RunningServer, nextBase: string): Promise<void> => {
		const { isInside } = await import("../../lib/path.ts");
		const { relativePath } = await import("./files/paths.ts");
		const inside = isInside(current.base, current.server.root);
		const rel = inside ? relativePath(current.base, current.server.root) : "";
		const candidate = rel ? join(nextBase, ...rel.split("/")) : nextBase;
		const info = await stat(candidate).catch(() => undefined);
		const nextRoot = info?.isDirectory() ? candidate : nextBase;
		try {
			current.server.reroot(nextRoot, await readersFor(nextRoot, current.config));
		} catch (error) {
			current.ctx.ui.notify(`browse: ${error instanceof Error ? error.message : String(error)}`, "error");
			return;
		}
		current.base = nextBase;
		current.ctx.ui.notify(`browse: followed to ${current.server.root} at ${current.server.url}`, "info");
	};

	/** Open the page's server; the server, git, HTTP, and browser modules live here. */
	const openServer = async (base: string, root: string, config: ServeConfig, ctx: ExtensionContext): Promise<void> => {
		const create = deps.createServer ?? (await import("./transport/server.ts")).createFileServer;
		const { requestMount } = await import("../../lib/http/index.ts");
		const { WORKTREE_CHANGED_CHANNEL } = await import("../../lib/events.ts");
		try {
			const outcome = await create({
				root,
				config,
				mount: (spec) => requestMount(pi, spec),
				session: sessionId,
				...(await readersFor(root, config)),
				onIdle: () => void stopWhenPageLeft(),
			});
			if (outcome.kind === "refused") {
				ctx.ui.notify(`browse: ${outcome.reason}`, "error");
				return;
			}
			const server = outcome.server;
			// The listener lives exactly as long as the page, so a session with no page
			// open holds no subscription to another extension's channel.
			running = { server, ctx, config, base, off: pi.events.on(WORKTREE_CHANGED_CHANNEL, () => follow()) };
			ctx.ui.notify(`browse: ${server.root} at ${server.url}`, "info");
			await openPage(server.url, config);
		} catch (error) {
			ctx.ui.notify(`browse: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	};

	const start = async (args: string, ctx: ExtensionContext): Promise<void> => {
		const target = args.trim();
		if (target === "status") {
			ctx.ui.notify(
				running ? `browse: ${running.server.root} at ${running.server.url}` : "browse: not running",
				"info",
			);
			return;
		}
		if (target === "stop") {
			ctx.ui.notify((await stop()) ? "browse: stopped" : "browse: not running", "info");
			return;
		}

		const base = baseOf(ctx);
		const resolved = await resolveRoot(target, base, ctx);
		if (resolved === undefined) return;
		const { root, config } = resolved;

		let realRoot = root;
		try {
			realRoot = realpathSync.native(root);
		} catch {
			// Keep the unresolved root; the server factory reports a real failure.
		}
		if (running && running.server.root === realRoot) {
			ctx.ui.notify(`browse: ${running.server.url} (already running)`, "info");
			// The page is already served, so this is an open and not a restart.
			await openPage(running.server.url, config);
			return;
		}

		await stop();
		await openServer(base, root, config, ctx);
	};

	pi.registerCommand("browse", {
		description: "Browse the working directory in a local browser (read-only): /browse [path | status | stop]",
		getArgumentCompletions: (prefix) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			const items = ["status", "stop"].filter((option) => option.startsWith(text));
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			await start(args, ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId();
	});

	pi.on("session_shutdown", async () => {
		await stop();
	});
}
