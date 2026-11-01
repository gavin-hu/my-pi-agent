/**
 * What one `inbox` read costs the model's context.
 *
 * `format.test.ts` pins the text a burst renders; this suite pins the other half, through
 * the tool: a bounded read consumes only the messages it showed, so the mail behind the
 * `… N more` line is still in the inbox for the next call. The read deletes what it takes,
 * and those two facts only hold together here.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { scratchDir } from "../../test/helpers/env.ts";
import { busToolSession as session, joinBusSession as joins } from "../../test/helpers/fixtures/session-bus-tool.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("an inbox read", () => {
	test("send and inbox travel between sessions", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);

		const sent = await frontend.tool.execute(
			"call",
			{ action: "send", to: "backend", text: "contract v2", kind: "event", paths: ["src/api"] },
			undefined,
			undefined,
			frontend.ctx,
		);
		expect(sent.details.delivered).toEqual(["backend"]);
		const inbox = await backend.tool.execute("call", { action: "inbox" }, undefined, undefined, backend.ctx);
		expect(inbox.details.messages).toHaveLength(1);
		expect(inbox.content[0]?.text).toContain("contract v2");
		const again = await backend.tool.execute("call", { action: "inbox" }, undefined, undefined, backend.ctx);
		expect(again.details.messages).toEqual([]);
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("expanded inbox lists what was consumed", () => {
		const frontend = session(scratchDir(temps, "pi-session-bus-"), "/repo/frontend", "s1", "frontend");
		const rendered = frontend.tool.renderResult(
			{
				content: [],
				details: {
					action: "inbox",
					messages: [
						{
							id: "m1",
							from: "s2",
							fromLabel: "backend",
							to: "s1",
							toLabel: "frontend",
							kind: "event",
							text: "contract v2",
							at: 1,
						},
					],
				},
			},
			{ expanded: true },
			fakeTheme,
		);
		const text = rendered.render(80).join("\n");
		expect(text).toContain("contract v2");
		expect(text).toContain("backend · event");
	});

	test("a burst is bounded, and the read consumes only what it showed", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);
		const body = "x".repeat(3_990);
		for (let index = 0; index < 20; index += 1) {
			await frontend.bus.send({ to: "backend", text: `${index} ${body}` });
		}

		const first = await backend.tool.execute("call", { action: "inbox" }, undefined, undefined, backend.ctx);
		const shown = first.details.messages.length;
		const text = first.content[0]?.text ?? "";
		expect(shown).toBeGreaterThan(1);
		expect(shown).toBeLessThan(20);
		// One message's worth of context, not twenty times four thousand characters.
		expect(text.length).toBeLessThan(5_000);
		expect(text).not.toContain(body);
		expect(text).toContain(`… ${20 - shown} more in the inbox — run \`inbox\` again.`);
		// The details are what the rows render from, so they keep the whole body.
		expect(first.details.messages[0]?.text).toContain(body);

		const rest = [];
		for (let call = 0; call < 20; call += 1) {
			const next = await backend.tool.execute("call", { action: "inbox" }, undefined, undefined, backend.ctx);
			if (next.details.messages.length === 0) break;
			rest.push(...next.details.messages);
		}
		// Nothing the first read did not show was deleted unseen.
		expect(rest).toHaveLength(20 - shown);
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("counts the mail past the peek's own cap, so the tail cannot saturate", async () => {
		// `peek` reads at most `MAX_LIMIT` of them, so a count taken from the window it
		// returned would stop there: 60 unread at the default limit read as 30 more.
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);
		for (let index = 0; index < 60; index += 1) {
			await frontend.bus.send({ to: "backend", text: `message ${index}` });
		}

		const first = await backend.tool.execute("call", { action: "inbox" }, undefined, undefined, backend.ctx);
		const shown = first.details.messages.length;
		expect(shown).toBe(20);
		expect(first.content[0]?.text).toEndWith(`… ${60 - shown} more in the inbox — run \`inbox\` again.`);
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("a limit still bounds the read, and the rest is named, not eaten", async () => {
		const dir = scratchDir(temps, "pi-session-bus-");
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);
		for (let index = 0; index < 5; index += 1) {
			await frontend.bus.send({ to: "backend", text: `message ${index}` });
		}

		const first = await backend.tool.execute("call", { action: "inbox", limit: 2 }, undefined, undefined, backend.ctx);
		expect(first.details.messages).toHaveLength(2);
		expect(first.content[0]?.text).toEndWith("… 3 more in the inbox — run `inbox` again.");

		const again = await backend.tool.execute("call", { action: "inbox" }, undefined, undefined, backend.ctx);
		expect(again.details.messages).toHaveLength(3);
		await frontend.bus.stop();
		await backend.bus.stop();
	});
});
