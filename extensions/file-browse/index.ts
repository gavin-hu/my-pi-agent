/**
 * file-browse — view the working directory in a browser.
 *
 * Registers the read-only `/browse` command. It starts a `node:http` server
 * bound to 127.0.0.1, rooted at the effective cwd, and opens the default
 * browser at a two-pane tree browser. No tool is registered; the server is
 * closed on `session_shutdown`, by `/browse stop`, and once its last page has
 * been gone for the idle grace — a closed window is not a running server.
 *
 * Load with:  pi --extension ./extensions/file-browse
 */

import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled, resolveEffectiveCwd } from "../../lib/env.ts";
import type { openInBrowser } from "../../lib/browser.ts";
import type { ServeConfig } from "./config/config.ts";
import type { FileServer } from "./transport/server.ts";

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

	/** Open the page's server; the server, git, HTTP, and browser modules live here. */
	const openServer = async (root: string, config: ServeConfig, ctx: ExtensionContext): Promise<void> => {
		const create = deps.createServer ?? (await import("./transport/server.ts")).createFileServer;
		const { createGitDiff, createGitStatus } = await import("./git/git.ts");
		const { requestMount } = await import("../../lib/http/index.ts");
		try {
			const outcome = await create({
				root,
				config,
				mount: (spec) => requestMount(pi, spec),
				session: sessionId,
				git: createGitStatus(pi, root),
				diff: createGitDiff(pi, root, {
					context: config.diffContext,
					maxLines: config.maxDiffLines,
					maxFileBytes: config.maxFileBytes,
					maxTextLines: config.maxTextLines,
				}),
				onIdle: () => void stopWhenPageLeft(),
			});
			if (outcome.kind === "refused") {
				ctx.ui.notify(`browse: ${outcome.reason}`, "error");
				return;
			}
			const server = outcome.server;
			running = { server, ctx };
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

		const cwd = resolveEffectiveCwd(ctx.cwd);
		const resolved = await resolveRoot(target, cwd, ctx);
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
		await openServer(root, config, ctx);
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
