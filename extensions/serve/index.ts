/**
 * serve — the one loopback server a session serves its pages on.
 *
 * It registers one bus listener and closes what it opened; it draws no page of its
 * own. `plan`, `board`, and `file-browse` ask for a path prefix on
 * {@link HTTP_MOUNT_CHANNEL} and the registry answers with the session's origin, so
 * a session has one port, one close path, and one chip instead of one socket per
 * extension. Binding happens on the first page that asks, never in the factory, and the
 * port it binds is the project's own number unless `serve.port` pins another — so a
 * bookmarked page URL survives a restart.
 *
 * Load with:  pi --extension ./extensions/serve
 */

import { networkInterfaces } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { HTTP_MOUNT_CHANNEL, type MountRequest } from "../../lib/http/mount.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { loadServeConfig } from "./config.ts";
import { createServeRegistry } from "./registry.ts";

export default function serve(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("serve")) return;
	/** Each session's working directory, so its pin is read from its own config. */
	const cwds = new Map<string, string>();
	/** Each session's context, which is where the port chip is drawn. */
	const contexts = new Map<string, ExtensionContext>();

	/** The directory a session serves: its config and its port both come from it. */
	const cwdOf = (session: string): string => cwds.get(session) ?? process.cwd();

	/**
	 * Publish the session's port, or clear the chip with `undefined`. The chip belongs
	 * to the server, not to a page: one number, shown while anything is served on it.
	 */
	const setChip = (session: string, port: number | undefined): void => {
		const ctx = contexts.get(session);
		if (ctx === undefined) return;
		try {
			const value =
				port === undefined
					? undefined
					: `${paint(ctx.ui.theme, "ok", GLYPHS.http)} ${paint(ctx.ui.theme, "accent", String(port))}`;
			ctx.ui.setStatus(STATUS_KEYS.http, value);
		} catch {
			// A host without a status line is not a reason to keep a page from starting.
		}
	};

	const registry = createServeRegistry({
		portFor: (session) => loadServeConfig(cwdOf(session)).port,
		pickPort: async (session) => {
			// The repository key is a git answer, so it is paid on the first bind rather than
			// at registration: a session that opens no page never asks for it.
			const [{ repoKeyFor }, { projectPort }] = await Promise.all([
				import("../../lib/repo-key.ts"),
				import("../../lib/http/port.ts"),
			]);
			return projectPort((await repoKeyFor(pi, cwdOf(session))).key);
		},
		interfaces: () => networkInterfaces(),
		onPort: setChip,
	});

	pi.events.on(HTTP_MOUNT_CHANNEL, (data) => {
		const request = data as Partial<MountRequest> | undefined;
		if (request?.spec === undefined) return;
		registry.handle(request as MountRequest);
	});

	pi.on("session_start", async (_event, ctx) => {
		const id = ctx.sessionManager.getSessionId();
		cwds.set(id, ctx.cwd);
		contexts.set(id, ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const id = ctx.sessionManager.getSessionId();
		await registry.closeSession(id);
		cwds.delete(id);
		contexts.delete(id);
	});
}
