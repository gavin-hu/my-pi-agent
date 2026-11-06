/**
 * What a send reached.
 *
 * A message is one file per inbox, written in a loop, so a fan-out can land for some peers
 * and not for others. The rule these cases pin: something delivered is a success that names
 * who was missed, nothing delivered is a failure — and `team`'s offer records the offer and
 * prints the peer it could not reach, instead of claiming nobody heard.
 *
 * The failure is staged on disk rather than through a seam, because that is the shape a real
 * one takes: a recipient's inbox path is a plain file, so `mkdir` refuses it on every
 * platform. The hash is the store's own, so the case blocks the inbox `send` will write.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { scratchDir } from "../../test/helpers/env.ts";
import { blockInbox } from "../../test/helpers/bus.ts";
import { busToolSession as session, joinBusSession as joins } from "../../test/helpers/fixtures/session-bus-tool.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("a send that reached some peers", () => {
	test("returns the peers it wrote for and the peers it could not", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		const third = session(dir, "/repo/third", "s3", "third");
		await joins(frontend);
		await joins(backend);
		await joins(third);
		blockInbox(dir, "s3");

		// The runtime answers rather than throwing: the recipients written before the failure
		// hold the message, and a caller cannot undo that.
		const sent = await frontend.bus.send({ to: "*", kind: "event", text: "build failed" });
		expect(sent.delivered).toEqual(["backend"]);
		expect(sent.failed.map((entry) => entry.label)).toEqual(["third"]);
		expect(sent.failed[0]?.error).not.toBe("");

		await frontend.bus.stop();
		await backend.bus.stop();
		await third.bus.stop();
	});

	test("says so on the result, and keeps the message for the peers it reached", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		const third = session(dir, "/repo/third", "s3", "third");
		await joins(frontend);
		await joins(backend);
		await joins(third);
		blockInbox(dir, "s3");

		const result = await frontend.tool.execute(
			"call",
			{ action: "send", to: "*", kind: "event", text: "build failed" },
			undefined,
			undefined,
			frontend.ctx,
		);
		expect(result.isError).toBeFalsy();
		expect(result.details.delivered).toEqual(["backend"]);
		expect(result.details.failed.map((entry: { label: string }) => entry.label)).toEqual(["third"]);
		expect(result.content[0]?.text).toContain("Delivered to backend");
		expect(result.content[0]?.text).toContain("Not delivered to third (");

		// The peer that was reached really has it: the report is not an apology for a drop.
		expect((await backend.bus.peek()).mail.map((message) => message.text)).toEqual(["build failed"]);

		await frontend.bus.stop();
		await backend.bus.stop();
		await third.bus.stop();
	});

	test("reaching nobody is a failure, so no caller reads it as delivered", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);
		blockInbox(dir, "s2");

		const result = await frontend.tool.execute(
			"call",
			{ action: "send", to: "backend", kind: "handoff", text: "take #2" },
			undefined,
			undefined,
			frontend.ctx,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Not delivered to backend");

		await frontend.bus.stop();
		await backend.bus.stop();
	});
});
