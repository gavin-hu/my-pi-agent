/**
 * file-browse — view the working directory in a browser.
 *
 * Registers the read-only `/browse` command. It starts a `node:http` server
 * bound to 127.0.0.1, rooted at the effective cwd, and opens the default
 * browser at a two-pane tree browser. No tool is registered; the server is
 * closed on `session_shutdown`.
 *
 * Load with:  pi --extension ./extensions/file-browse
 */

import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled, resolveEffectiveCwd } from "../../lib/env.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/ui.ts";
import { loadConfig, randomPort } from "./config.ts";
import { createGitStatus } from "./git.ts";
import { openInBrowser } from "../../lib/browser.ts";
import { HttpError, resolveRequestPath } from "./paths.ts";
import { createFileServer, type FileServer } from "./server.ts";

export interface FileBrowserDeps {
	/** Override the server factory (tests). */
	createServer?: typeof createFileServer;
	/** Override the browser opener (tests). */
	open?: typeof openInBrowser;
	/** Override session-port selection (tests). */
	pickPort?: () => number;
}

interface RunningServer {
	server: FileServer;
}

export default function fileBrowser(pi: ExtensionAPI, deps: FileBrowserDeps = {}): void {
	if (!isExtensionEnabled("file-browse")) return;
	let running: RunningServer | undefined;
	/** Random port fixed for the session after the first successful start. */
	let sessionPort: number | undefined;

	/** Publish the browse chip, or clear it with `undefined`; best-effort UI. */
	const setBrowseStatus = (ctx: ExtensionContext, port: number | undefined): void => {
		try {
			const value =
				port === undefined
					? undefined
					: `${ctx.ui.theme.fg("success", GLYPHS.browse)} ${ctx.ui.theme.fg("accent", String(port))}`;
			ctx.ui.setStatus(STATUS_KEYS.browse, value);
		} catch {
			// A UI without a theme or setStatus must not break the command.
		}
	};

	const stop = async (ctx?: ExtensionContext): Promise<boolean> => {
		const current = running;
		if (!current) return false;
		running = undefined;
		await current.server.close();
		if (ctx) setBrowseStatus(ctx, undefined);
		return true;
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
			ctx.ui.notify((await stop(ctx)) ? "browse: stopped" : "browse: not running", "info");
			return;
		}

		const cwd = resolveEffectiveCwd(ctx.cwd);
		const config = loadConfig(cwd);
		// A pinned config port wins; otherwise one random port is fixed for the session.
		const unpinned = config.port <= 0;
		const port = unpinned ? (sessionPort ?? (deps.pickPort ?? randomPort)()) : config.port;
		let root = cwd;
		if (target) {
			try {
				root = await resolveRequestPath(cwd, target);
			} catch (error) {
				const message = error instanceof HttpError ? error.message : String(error);
				ctx.ui.notify(`browse: ${message}`, "error");
				return;
			}
			const info = await stat(root).catch(() => undefined);
			if (!info?.isDirectory()) {
				ctx.ui.notify(`browse: ${target} is not a folder inside the working directory`, "error");
				return;
			}
		}

		let realRoot = root;
		try {
			realRoot = realpathSync.native(root);
		} catch {
			// Keep the unresolved root; the server factory reports a real failure.
		}
		if (running && running.server.root === realRoot && running.server.port === port) {
			ctx.ui.notify(`browse: ${running.server.url} (already running)`, "info");
			return;
		}

		await stop(ctx);
		const create = deps.createServer ?? createFileServer;
		try {
			const server = await create({ root, config: { ...config, port }, git: createGitStatus(pi, root) });
			if (unpinned) sessionPort = port;
			running = { server };
			setBrowseStatus(ctx, server.port);
			ctx.ui.notify(`browse: ${server.root} at ${server.url}`, "info");
			if (config.autoOpen) (deps.open ?? openInBrowser)(server.url);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException | undefined)?.code;
			if (code === "EADDRINUSE") {
				ctx.ui.notify(
					`browse: port ${port} is in use; run /browse again to try another or set "port" in file-browse.json`,
					"error",
				);
			} else {
				ctx.ui.notify(`browse: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		}
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

	pi.on("session_shutdown", async (_event, ctx) => {
		await stop(ctx);
		sessionPort = undefined;
	});
}
