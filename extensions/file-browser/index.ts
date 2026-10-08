/**
 * file-browser — view the working directory in a browser.
 *
 * Registers the read-only `/serve` command. It starts a `node:http` server
 * bound to 127.0.0.1, rooted at the effective cwd, and opens the default
 * browser at a two-pane tree browser. No tool is registered; the server is
 * closed on `session_shutdown`.
 *
 * Load with:  pi --extension ./extensions/file-browser
 */

import { stat } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../_shared/worktree-env.ts";
import { loadConfig } from "./config.ts";
import { openInBrowser } from "./open.ts";
import { HttpError, resolveRequestPath } from "./paths.ts";
import { createFileServer, type FileServer } from "./server.ts";

export interface FileBrowserDeps {
	/** Override the server factory (tests). */
	createServer?: typeof createFileServer;
	/** Override the browser opener (tests). */
	open?: typeof openInBrowser;
}

interface RunningServer {
	server: FileServer;
	root: string;
}

export default function fileBrowser(pi: ExtensionAPI, deps: FileBrowserDeps = {}): void {
	let running: RunningServer | undefined;

	const stop = async (): Promise<boolean> => {
		const current = running;
		if (!current) return false;
		running = undefined;
		await current.server.close();
		return true;
	};

	const start = async (args: string, ctx: ExtensionContext): Promise<void> => {
		const target = args.trim();
		if (target === "status") {
			ctx.ui.notify(running ? `serve: ${running.root} at ${running.server.url}` : "serve: not running", "info");
			return;
		}
		if (target === "stop") {
			ctx.ui.notify((await stop()) ? "serve: stopped" : "serve: not running", "info");
			return;
		}

		const cwd = resolveEffectiveCwd(ctx.cwd);
		const config = loadConfig(cwd);
		let root = cwd;
		if (target) {
			try {
				root = await resolveRequestPath(cwd, target);
			} catch (error) {
				const message = error instanceof HttpError ? error.message : String(error);
				ctx.ui.notify(`serve: ${message}`, "error");
				return;
			}
			const info = await stat(root).catch(() => undefined);
			if (!info?.isDirectory()) {
				ctx.ui.notify(`serve: ${target} is not a folder inside the working directory`, "error");
				return;
			}
		}

		await stop();
		const create = deps.createServer ?? createFileServer;
		try {
			const server = await create({ root, config });
			running = { server, root: server.root };
			ctx.ui.notify(`serve: ${server.root} at ${server.url}`, "info");
			if (config.autoOpen) (deps.open ?? openInBrowser)(server.url);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException | undefined)?.code;
			if (code === "EADDRINUSE") {
				ctx.ui.notify(`serve: port ${config.port} is in use; set "port": 0 in file-browser.json`, "error");
			} else {
				ctx.ui.notify(`serve: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		}
	};

	pi.registerCommand("serve", {
		description: "Serve the working directory in a local browser (read-only)",
		handler: async (args, ctx) => {
			await start(args, ctx);
		},
	});

	pi.on("session_shutdown", async () => {
		await stop();
	});
}
