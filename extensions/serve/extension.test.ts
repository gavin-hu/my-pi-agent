/**
 * The serve extension's Pi integration: the bus listener, the session's context, the
 * one port chip, and the shutdown that closes what a page opened.
 *
 * A request travels `requestMount`, which is the path a page takes, so the claim and
 * its fallback are the shipped ones rather than a test's impression of them.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { portIsFree } from "../../test/helpers/serve.ts";
import {
	type LoopbackHandler,
	PORT_BASE,
	PORT_RANGE,
	projectPort,
	requestMount,
	textResponse,
} from "../../lib/http/index.ts";
import { repoKeyOf } from "../../lib/repo-key.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import serveExtension from "./index.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A page that answers nothing in particular; the suite is about its place, not its body. */
const handler: LoopbackHandler = async () => ({ result: textResponse(200, "ok") });

/** Load the extension into a fake host, with nothing disabled unless a case says so. */
async function load(disabled?: string) {
	const fake = createFakePi();
	await withEnv({ PI_DISABLED_EXTENSIONS: disabled }, () => serveExtension(fake.pi));
	return fake;
}

/** Start a session in `cwd` and open its first page. */
async function opened(cwd: string = temps.track(tempDir("pi-serve-"))) {
	const fake = await load();
	const harness = fakeCtx({ sessionId: "s1", cwd });
	await emit(fake.pi, "session_start", {}, harness.ctx);
	const outcome = await requestMount(fake.pi, { session: "s1", prefix: "/board", handler });
	if (outcome.kind !== "mounted") throw new Error(`expected a mount, got: ${outcome.reason}`);
	return { fake, harness, cwd, mount: outcome.mount };
}

/** Tries before a case gives up on the band being free. */
const PORT_ATTEMPTS = 8;

/**
 * A project whose own number nobody holds right now.
 *
 * The number is a hash into a band shared with whatever else this machine runs, so a
 * case that asserts the number has to pick a project whose number is free: a fresh
 * temp directory is a fresh hash into all of it, and a band nobody can free fails naming
 * the numbers it tried — that is the machine, not the code under test.
 */
async function projectWithFreePort(): Promise<{ cwd: string; port: number }> {
	const tried: number[] = [];
	for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
		const cwd = temps.track(tempDir("pi-serve-"));
		const port = projectPort(repoKeyOf(cwd));
		if (await portIsFree(port)) return { cwd, port };
		tried.push(port);
	}
	throw new Error(
		`no project number was free in ${PORT_BASE}-${PORT_BASE + PORT_RANGE - 1} after ${PORT_ATTEMPTS} tries (${tried.join(", ")}) — this machine is holding the band, not the code`,
	);
}

describe("registration", () => {
	test("listens on the mount channel and answers a session's lifecycle", async () => {
		const fake = await load();
		expect(fake.handlers.get("session_start")).toHaveLength(1);
		expect(fake.handlers.get("session_shutdown")).toHaveLength(1);
		// Nothing is bound at load: a session with no page open holds no port.
		const outcome = await requestMount(fake.pi, { session: "s1", prefix: "/board", handler });
		expect(outcome.kind).toBe("mounted");
		if (outcome.kind === "mounted") await outcome.mount.release();
	});

	test("obeys PI_DISABLED_EXTENSIONS, leaving a page with no owner", async () => {
		const fake = await load("serve");
		expect(fake.handlers.has("session_shutdown")).toBe(false);
		const outcome = await requestMount(fake.pi, { session: "s1", prefix: "/board", handler });
		expect(outcome.kind).toBe("refused");
	});
});

describe("the project's port", () => {
	test("is the repository's, so a restart lands on the same one", async () => {
		const project = await projectWithFreePort();
		const first = await opened(project.cwd);
		expect(first.mount.port).toBe(project.port);

		await emit(first.fake.pi, "session_shutdown", {}, first.harness.ctx);
		// A session started again in the same project is the restart a bookmark sees, and the
		// number is the repository's rather than a fresh draw.
		const second = fakeCtx({ sessionId: "s2", cwd: first.cwd });
		await emit(first.fake.pi, "session_start", {}, second.ctx);
		const outcome = await requestMount(first.fake.pi, { session: "s2", prefix: "/board", handler });
		if (outcome.kind !== "mounted") throw new Error(`expected a mount, got: ${outcome.reason}`);
		expect(outcome.mount.port).toBe(first.mount.port);
		await outcome.mount.release();
	});
});

describe("the port chip", () => {
	test("shows the session's port while anything is served, then clears", async () => {
		const { harness, mount } = await opened();
		const chip = harness.statuses.get(STATUS_KEYS.http) as string;
		expect(chip).toContain(String(mount.port));
		expect(chip).toStartWith(GLYPHS.http);

		await mount.release();
		expect(harness.statuses.has(STATUS_KEYS.http)).toBe(false);
		// The cleared chip is drawn with no text at all, which is how the bar forgets it.
		expect(harness.statusCalls.at(-1)?.text).toBeUndefined();
	});

	test("closes the session's socket when the session ends", async () => {
		const { fake, harness, mount } = await opened();
		await emit(fake.pi, "session_shutdown", {}, harness.ctx);
		await expect(fetch(`${mount.origin}/board/`)).rejects.toThrow();
		expect(harness.statuses.has(STATUS_KEYS.http)).toBe(false);
	});
});
