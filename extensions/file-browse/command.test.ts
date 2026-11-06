/**
 * The `/browse` command's own surface: what it registers, how it reports, and what it
 * opens. Split out of `transport/router.test.ts` when that suite passed the size bar —
 * the command is one capability, the loopback transport another.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { ENV_DISABLED_EXTENSIONS, ENV_ROOT } from "../../lib/env.ts";
import { useEnv, withEnv } from "../../test/helpers/env.ts";
import { createFakePi, emit, type FakePi } from "../../test/helpers/fakes.ts";
import { fileBrowseCtx, makeFixture, runCommand, type Fixture } from "../../test/helpers/fixtures/file-browse.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import fileBrowser from "./index.ts";
import type { FileServer, FileServerOptions, FileServerResult } from "./transport/server.ts";

const env = useEnv({ [ENV_ROOT]: undefined });
afterAll(() => env.restore());

let fixture: Fixture | undefined;
let other: Fixture | undefined;

afterEach(() => {
	fixture?.remove();
	fixture = undefined;
	other?.remove();
	other = undefined;
});

function fakeServer(root: string): FileServerResult {
	return {
		kind: "served",
		server: { url: "http://127.0.0.1:4321/files/", port: 4321, root, reroot: () => {}, close: async () => {} },
	};
}

/** The page a fake result carries, for a case that only needs one field of it. */
function servedOf(result: FileServerResult): FileServer {
	if (result.kind !== "served") throw new Error(result.reason);
	return result.server;
}

/** A fake page whose served root moves with `reroot`, so a follow can be observed. */
function movableServer(root: string): {
	result: FileServerResult;
	reroots: Array<{ root: string; readers: boolean }>;
} {
	let served = root;
	const reroots: Array<{ root: string; readers: boolean }> = [];
	return {
		reroots,
		result: {
			kind: "served",
			server: {
				url: "http://127.0.0.1:4321/files/",
				port: 4321,
				get root() {
					return served;
				},
				reroot(next, readers) {
					served = realpathSync.native(next);
					reroots.push({ root: served, readers: Boolean(readers?.git && readers.diff) });
				},
				close: async () => {},
			},
		},
	};
}

/**
 * Publish the switch a worktree enter or exit publishes.
 *
 * The effective root is the environment's, exactly as `/browse` reads it, so a case
 * sets the variable the switch would set and then emits the trigger. The page reacts
 * asynchronously — it loads the modules a re-root needs — so a case that expects a move
 * waits on the recorder rather than on the emit.
 */
async function switchTo(root: string, pi: FakePi["pi"]): Promise<void> {
	await withEnv({ [ENV_ROOT]: root }, async () => {
		pi.events.emit("worktree:changed", { active: true, path: root });
	});
}

const noOpen = () => {};

describe("browse command", () => {
	test("registers nothing when disabled", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "file-browse" }, () => {
			const { pi, commands, handlers } = createFakePi();
			fileBrowser(pi);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers /browse and completes its subcommands", () => {
		const { pi, commands } = createFakePi();
		fileBrowser(pi);
		expect(commands.has("browse")).toBe(true);
		const complete = (prefix: string): string[] =>
			(commands.get("browse").getArgumentCompletions(prefix) ?? []).map((item: { label: string }) => item.label);
		expect(complete("")).toEqual(["status", "stop"]);
		expect(complete("stat")).toEqual(["status"]);
		expect(complete("status ")).toEqual([]);
	});

	test("reports not running before a start", async () => {
		const { pi } = createFakePi();
		fileBrowser(pi);
		const { ctx, notifications } = fileBrowseCtx("/tmp/repo");
		await runCommand(pi, "browse", "status", ctx);
		expect(notifications.at(-1)?.message).toContain("not running");
	});

	test("opens the page again when one is already served for the same root", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		const opened: string[] = [];
		let closes = 0;
		let creates = 0;
		fileBrowser(pi, {
			createServer: async () => {
				creates += 1;
				return {
					kind: "served",
					server: { ...servedOf(fakeServer(fixture!.root)), close: async () => void closes++ },
				};
			},
			open: (url) => {
				opened.push(url);
			},
		});
		const { ctx, notifications } = fileBrowseCtx(fixture.root);

		await runCommand(pi, "browse", "", ctx);
		await runCommand(pi, "browse", "", ctx);

		// A second `/browse` shows the page it already serves instead of only naming it.
		expect(opened).toEqual(["http://127.0.0.1:4321/files/", "http://127.0.0.1:4321/files/"]);
		expect(notifications.at(-1)?.message).toContain("already running");
		expect(creates).toBe(1);
		expect(closes).toBe(0);
	});

	test("starts, opens the browser, reports status, and stops", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		const opened: string[] = [];
		let closes = 0;
		fileBrowser(pi, {
			createServer: async () => ({
				kind: "served",
				server: { ...servedOf(fakeServer(fixture!.root)), close: async () => void closes++ },
			}),
			open: (url) => {
				opened.push(url);
			},
		});
		const { ctx, notifications } = fileBrowseCtx(fixture.root);

		await runCommand(pi, "browse", "", ctx);
		expect(opened).toEqual(["http://127.0.0.1:4321/files/"]);
		expect(notifications.at(-1)?.message).toContain("4321");

		await runCommand(pi, "browse", "status", ctx);
		expect(notifications.at(-1)?.message).toContain("4321");

		await runCommand(pi, "browse", "stop", ctx);
		expect(closes).toBe(1);
		expect(notifications.at(-1)?.message).toContain("stopped");
	});

	test("closes the server on session shutdown", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		let closes = 0;
		fileBrowser(pi, {
			open: noOpen,
			createServer: async () => ({
				kind: "served",
				server: { ...servedOf(fakeServer(fixture!.root)), close: async () => void closes++ },
			}),
		});
		const { ctx } = fileBrowseCtx(fixture.root);
		await runCommand(pi, "browse", "", ctx);
		await emit(pi, "session_shutdown", {}, ctx);
		expect(closes).toBe(1);
	});

	test("reports the reason the session's server refused the page", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		fileBrowser(pi, {
			open: noOpen,
			// The one way a mount is refused: the prefix is another page's.
			createServer: async () => ({ kind: "refused", reason: "the serve extension is not loaded" }),
		});
		const { ctx, notifications } = fileBrowseCtx(fixture.root);
		await runCommand(pi, "browse", "", ctx);
		expect(notifications.at(-1)?.level).toBe("error");
		expect(notifications.at(-1)?.message).toContain("serve extension is not loaded");
	});

	test("refuses a subpath that is not a folder", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		fileBrowser(pi, { createServer: async () => fakeServer(fixture!.root), open: noOpen });
		const { ctx, notifications } = fileBrowseCtx(fixture.root);
		await runCommand(pi, "browse", "a.txt", ctx);
		expect(notifications.at(-1)?.level).toBe("error");
	});

	test("serves a subfolder of a root reached through a symlink", async () => {
		fixture = makeFixture();
		// A checkout under `/tmp` or `/var` is itself a symlink on macOS, so the root has to be
		// canonical before a subpath is resolved against it: the containment check reads a raw
		// root and the realpath'd candidate as an escape.
		if (!fixture.hasSymlinks) return;
		const link = join(fixture.outside, "linked-root");
		symlinkSync(fixture.root, link);
		let served = "";
		const { pi } = createFakePi();
		fileBrowser(pi, {
			open: noOpen,
			createServer: async (options: FileServerOptions) => {
				served = options.root;
				return fakeServer(options.root);
			},
		});
		const { ctx, notifications } = fileBrowseCtx(link);
		await runCommand(pi, "browse", "sub", ctx);

		expect(notifications.at(-1)?.level).toBe("info");
		expect(served).toBe(join(fixture.root, "sub"));
	});

	test("follows the session into the worktree it switched to", async () => {
		fixture = makeFixture();
		other = makeFixture();
		const { pi } = createFakePi();
		const page = movableServer(fixture.root);
		fileBrowser(pi, { createServer: async () => page.result, open: noOpen });
		const { ctx, notifications } = fileBrowseCtx(fixture.root);
		await runCommand(pi, "browse", "", ctx);

		await switchTo(other.root, pi);
		await waitFor(() => page.reroots.length === 1);

		// The readers are rebuilt for the new root, so the header's git context and the
		// diff view are the new tree's, not the one the session left.
		expect(page.reroots).toEqual([{ root: other.root, readers: true }]);
		expect(notifications.at(-1)).toEqual({
			level: "info",
			message: `browse: followed to ${other.root} at http://127.0.0.1:4321/files/`,
		});
		await runCommand(pi, "browse", "status", ctx);
		expect(notifications.at(-1)?.message).toContain(other.root);
	});

	test("keeps a subfolder root under the new tree, and falls back to its base", async () => {
		fixture = makeFixture();
		other = makeFixture();
		const bare = makeFixture();
		const { pi } = createFakePi();
		const page = movableServer(join(fixture.root, "sub"));
		fileBrowser(pi, { createServer: async () => page.result, open: noOpen });
		const { ctx } = fileBrowseCtx(fixture.root);
		await runCommand(pi, "browse", "sub", ctx);

		await switchTo(other.root, pi);
		await waitFor(() => page.reroots.length === 1);
		expect(page.reroots.at(-1)?.root).toBe(join(other.root, "sub"));

		// A tree without that folder serves its own root instead of failing the follow.
		rmSync(join(bare.root, "sub"), { recursive: true, force: true });
		await switchTo(bare.root, pi);
		await waitFor(() => page.reroots.length === 2);
		expect(page.reroots.at(-1)?.root).toBe(bare.root);
		bare.remove();
	});

	test("stays put when the announced tree is the one it serves", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		const page = movableServer(fixture.root);
		fileBrowser(pi, { createServer: async () => page.result, open: noOpen });
		const { ctx } = fileBrowseCtx(fixture.root);
		await runCommand(pi, "browse", "", ctx);

		// The gate is synchronous, so nothing needs waiting for: the same tree is the
		// page's own, and the event costs no reads at all.
		await switchTo(fixture.root, pi);
		expect(page.reroots).toEqual([]);
	});

	test("drops the listener with the page it served", async () => {
		fixture = makeFixture();
		other = makeFixture();
		const { pi } = createFakePi();
		const page = movableServer(fixture.root);
		fileBrowser(pi, { createServer: async () => page.result, open: noOpen });
		const { ctx } = fileBrowseCtx(fixture.root);
		await runCommand(pi, "browse", "", ctx);
		await runCommand(pi, "browse", "stop", ctx);

		const target = other.root;
		await withEnv({ [ENV_ROOT]: target }, async () => {
			pi.events.emit("worktree:changed", { active: true, path: target });
			await settle(25);
		});
		expect(page.reroots).toEqual([]);
	});
});
