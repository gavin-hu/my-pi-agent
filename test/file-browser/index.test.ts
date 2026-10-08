import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fileBrowser from "../../extensions/file-browser/index.ts";
import type { FileServer } from "../../extensions/file-browser/server.ts";
import { createFakePi, fakeCtx, makeFixture, runCommand, type Fixture } from "./helpers.ts";
import { emit } from "../helpers/fakes.ts";

let fixture: Fixture | undefined;
let previousRoot: string | undefined;

beforeEach(() => {
	previousRoot = process.env.PI_WORKTREE_ROOT;
	delete process.env.PI_WORKTREE_ROOT;
});

afterEach(() => {
	if (previousRoot === undefined) delete process.env.PI_WORKTREE_ROOT;
	else process.env.PI_WORKTREE_ROOT = previousRoot;
	fixture?.remove();
	fixture = undefined;
});

function fakeServer(root: string): FileServer {
	return { url: "http://127.0.0.1:4321/", port: 4321, root, close: async () => {} };
}

describe("file-browser extension", () => {
	test("registers the /serve command", () => {
		const { pi, commands } = createFakePi();
		fileBrowser(pi);
		expect(commands.has("serve")).toBe(true);
	});

	test("reports not running before a start", async () => {
		const { pi } = createFakePi();
		fileBrowser(pi);
		const { ctx, notifications } = fakeCtx("/tmp/repo");

		await runCommand(pi, "serve", "status", ctx);
		expect(notifications.at(-1)?.message).toContain("not running");
	});

	test("starts, opens the browser, reports the URL, and stops", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		const opened: string[] = [];
		let closes = 0;
		const started = {
			...fakeServer(fixture.root),
			close: async () => {
				closes++;
			},
		};
		fileBrowser(pi, { createServer: (async () => started) as any, open: (url) => opened.push(url) });
		const { ctx, notifications } = fakeCtx(fixture.root);

		await runCommand(pi, "serve", "", ctx);
		expect(opened).toEqual(["http://127.0.0.1:4321/"]);
		expect(notifications.at(-1)?.message).toContain("4321");

		await runCommand(pi, "serve", "status", ctx);
		expect(notifications.at(-1)?.message).toContain("4321");

		await runCommand(pi, "serve", "stop", ctx);
		expect(closes).toBe(1);
		expect(notifications.at(-1)?.message).toContain("stopped");
	});

	test("closes the server on session shutdown", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		let closes = 0;
		fileBrowser(pi, {
			createServer: (async () => ({
				...fakeServer(fixture!.root),
				close: async () => {
					closes++;
				},
			})) as any,
		});
		const { ctx } = fakeCtx(fixture.root);

		await runCommand(pi, "serve", "", ctx);
		await emit(pi, "session_shutdown", {}, ctx);
		expect(closes).toBe(1);
	});

	test("reports a port conflict with a hint", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		fileBrowser(pi, {
			createServer: (async () => {
				const error = new Error("in use") as NodeJS.ErrnoException;
				error.code = "EADDRINUSE";
				throw error;
			}) as any,
		});
		const { ctx, notifications } = fakeCtx(fixture.root);

		await runCommand(pi, "serve", "", ctx);
		expect(notifications.at(-1)?.level).toBe("error");
		expect(notifications.at(-1)?.message).toContain("in use");
	});

	test("refuses a subpath that is not a folder", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		fileBrowser(pi, { createServer: (async () => fakeServer(fixture!.root)) as any });
		const { ctx, notifications } = fakeCtx(fixture.root);

		await runCommand(pi, "serve", "a.txt", ctx);
		expect(notifications.at(-1)?.level).toBe("error");
	});
});
