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
import { type LoopbackHandler, requestMount, textResponse } from "../../lib/http/index.ts";
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

/** Start a session and open its first page. */
async function opened(disabled?: string) {
	const fake = await load(disabled);
	const harness = fakeCtx({ sessionId: "s1", cwd: temps.track(tempDir("pi-serve-")) });
	await emit(fake.pi, "session_start", {}, harness.ctx);
	const outcome = await requestMount(fake.pi, { session: "s1", prefix: "/board", handler });
	if (outcome.kind !== "mounted") throw new Error(`expected a mount, got: ${outcome.reason}`);
	return { fake, harness, mount: outcome.mount };
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
