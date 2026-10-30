/**
 * The `/browse` command's own surface: what it registers, how it reports, and what it
 * opens. Split out of `transport/router.test.ts` when that suite passed the size bar —
 * the command is one capability, the loopback transport another.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { useEnv, withEnv } from "../../test/helpers/env.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import { fakeCtx, makeFixture, runCommand, type Fixture } from "../../test/helpers/fixtures/file-browse.ts";
import fileBrowser from "./index.ts";
import type { FileServer, FileServerResult } from "./transport/server.ts";

const env = useEnv({ PI_WORKTREE_ROOT: undefined });
afterAll(() => env.restore());

let fixture: Fixture | undefined;

afterEach(() => {
	fixture?.remove();
	fixture = undefined;
});

function fakeServer(root: string): FileServerResult {
	return { kind: "served", server: { url: "http://127.0.0.1:4321/files/", port: 4321, root, close: async () => {} } };
}

/** The page a fake result carries, for a case that only needs one field of it. */
function servedOf(result: FileServerResult): FileServer {
	if (result.kind !== "served") throw new Error(result.reason);
	return result.server;
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
		const { ctx, notifications } = fakeCtx("/tmp/repo");
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
		const { ctx, notifications } = fakeCtx(fixture.root);

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
		const { ctx, notifications } = fakeCtx(fixture.root);

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
		const { ctx } = fakeCtx(fixture.root);
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
		const { ctx, notifications } = fakeCtx(fixture.root);
		await runCommand(pi, "browse", "", ctx);
		expect(notifications.at(-1)?.level).toBe("error");
		expect(notifications.at(-1)?.message).toContain("serve extension is not loaded");
	});

	test("refuses a subpath that is not a folder", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		fileBrowser(pi, { createServer: async () => fakeServer(fixture!.root), open: noOpen });
		const { ctx, notifications } = fakeCtx(fixture.root);
		await runCommand(pi, "browse", "a.txt", ctx);
		expect(notifications.at(-1)?.level).toBe("error");
	});
});
