import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import fileBrowser from "./index.ts";
import type { FileServer } from "./server.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/ui.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { coloringTheme, createFakePi, emit } from "../../test/helpers/fakes.ts";
import { fakeCtx, makeFixture, runCommand, type Fixture } from "../../test/helpers/fixtures/file-browser.ts";
import { useEnv, withEnv } from "../../test/helpers/env.ts";

const noOpen = () => {};

let fixture: Fixture | undefined;

beforeEach(() => {
	// The preload restores PI_WORKTREE_ROOT after each test.
	useEnv({ PI_WORKTREE_ROOT: undefined });
});

afterEach(() => {
	fixture?.remove();
	fixture = undefined;
});

function fakeServer(root: string): FileServer {
	return { url: "http://127.0.0.1:4321/", port: 4321, root, close: async () => {} };
}

describe("file-browser extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "file-browser" }, () => {
			const { pi, commands, handlers } = createFakePi();
			fileBrowser(pi);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

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

	test("reprints without restarting when the root is unchanged", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		let creates = 0;
		const opened: string[] = [];
		fileBrowser(pi, {
			open: (url) => opened.push(url),
			pickPort: () => 4321,
			createServer: (async () => {
				creates++;
				return fakeServer(fixture!.root);
			}) as any,
		});
		const { ctx, notifications } = fakeCtx(fixture.root);

		await runCommand(pi, "serve", "", ctx);
		await runCommand(pi, "serve", "", ctx);

		expect(creates).toBe(1);
		expect(opened).toEqual(["http://127.0.0.1:4321/"]);
		expect(notifications.at(-1)?.message).toContain("already running");
	});

	test("publishes a two-tone serve chip and clears it on stop", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		fileBrowser(pi, { createServer: (async () => fakeServer(fixture!.root)) as any, open: noOpen });
		const { ctx, statuses } = fakeCtx(fixture.root);

		await runCommand(pi, "serve", "", ctx);
		expect(statuses.get(STATUS_KEYS.serve)).toBe(`${GLYPHS.serve} 4321`);

		await runCommand(pi, "serve", "stop", ctx);
		expect(statuses.has(STATUS_KEYS.serve)).toBe(false);
	});

	test("publishes the chip with success and accent colors", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		fileBrowser(pi, { createServer: (async () => fakeServer(fixture!.root)) as any, open: noOpen });
		const { ctx, statuses } = fakeCtx(fixture.root, "print", {
			theme: coloringTheme,
		});

		await runCommand(pi, "serve", "", ctx);
		expect(statuses.get(STATUS_KEYS.serve)).toBe(`[success]${GLYPHS.serve} [accent]4321`);
	});

	test("clears the chip on session shutdown", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		fileBrowser(pi, { createServer: (async () => fakeServer(fixture!.root)) as any, open: noOpen });
		const { ctx, statuses } = fakeCtx(fixture.root);

		await runCommand(pi, "serve", "", ctx);
		await emit(pi, "session_shutdown", {}, ctx);
		expect(statuses.has(STATUS_KEYS.serve)).toBe(false);
	});

	test("fixes one random port for the session across roots and restarts", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		const ports: number[] = [];
		fileBrowser(pi, {
			open: noOpen,
			pickPort: () => 4321,
			createServer: (async (options: { config: { port: number } }) => {
				ports.push(options.config.port);
				return fakeServer(fixture!.root);
			}) as any,
		});
		const { ctx } = fakeCtx(fixture.root);

		await runCommand(pi, "serve", "", ctx);
		await runCommand(pi, "serve", "sub", ctx);
		await runCommand(pi, "serve", "stop", ctx);
		await runCommand(pi, "serve", "", ctx);

		expect(ports).toEqual([4321, 4321, 4321]);
	});

	test("rolls another random port after a conflict, then reuses it", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		const ports: number[] = [];
		const picks = [1111, 2222];
		let call = 0;
		fileBrowser(pi, {
			open: noOpen,
			pickPort: () => picks[call++] ?? 9999,
			createServer: (async (options: { config: { port: number } }) => {
				ports.push(options.config.port);
				if (options.config.port === 1111) {
					const error = new Error("in use") as NodeJS.ErrnoException;
					error.code = "EADDRINUSE";
					throw error;
				}
				return fakeServer(fixture!.root);
			}) as any,
		});
		const { ctx, notifications } = fakeCtx(fixture.root);

		await runCommand(pi, "serve", "", ctx);
		expect(notifications.at(-1)?.level).toBe("error");

		await runCommand(pi, "serve", "", ctx);
		expect(notifications.at(-1)?.level).toBe("info");

		await runCommand(pi, "serve", "", ctx);
		expect(ports).toEqual([1111, 2222, 2222]);
	});

	test("uses a pinned config port instead of the session port", async () => {
		fixture = makeFixture();
		mkdirSync(join(fixture.root, ".pi"), { recursive: true });
		writeFileSync(join(fixture.root, ".pi", "file-browser.json"), JSON.stringify({ port: 8080 }));
		const { pi } = createFakePi();
		const ports: number[] = [];
		fileBrowser(pi, {
			open: noOpen,
			pickPort: () => 4321,
			createServer: (async (options: { config: { port: number } }) => {
				ports.push(options.config.port);
				return fakeServer(fixture!.root);
			}) as any,
		});
		const { ctx } = fakeCtx(fixture.root);

		await runCommand(pi, "serve", "", ctx);
		expect(ports).toEqual([8080]);
	});

	test("closes the server on session shutdown", async () => {
		fixture = makeFixture();
		const { pi } = createFakePi();
		let closes = 0;
		fileBrowser(pi, {
			open: noOpen,
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
			open: noOpen,
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
		fileBrowser(pi, { createServer: (async () => fakeServer(fixture!.root)) as any, open: noOpen });
		const { ctx, notifications } = fakeCtx(fixture.root);

		await runCommand(pi, "serve", "a.txt", ctx);
		expect(notifications.at(-1)?.level).toBe("error");
	});
});
