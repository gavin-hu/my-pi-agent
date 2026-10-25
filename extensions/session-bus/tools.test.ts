import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createFakePi, fakeTheme } from "../../test/helpers/fakes.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";
import { registerTools } from "./tools.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

function busDir(): string {
	return temps.track(tempDir("pi-session-bus-"));
}

interface Session {
	bus: SessionBus;
	ctx: ExtensionContext;
	/** The Pi surface the tool writes a rename through. */
	pi: { getSessionName(): string | undefined; setSessionName(name: string): void };
	tool: {
		execute(
			id: string,
			params: unknown,
			signal?: undefined,
			update?: undefined,
			ctx?: ExtensionContext,
		): Promise<{ content: Array<{ text: string }>; details: any; isError?: true }>;
		renderCall(
			args: unknown,
			theme: unknown,
			context?: { lastComponent?: unknown },
		): { render(width: number): string[] };
		renderResult(
			result: { content: Array<{ type: string; text?: string }>; details: unknown },
			options: { expanded: boolean },
			theme: unknown,
			context?: { lastComponent?: unknown },
		): { render(width: number): string[] };
	};
}

function session(dir: string, root: string, id: string, name: string): Session {
	const bus = createSessionBus({} as ExtensionAPI, {
		dir,
		repo: { root, key: "shared" },
		now: () => 1_000,
		heartbeatMs: 0,
	});
	const fake = createFakePi();
	// Pi's session name and the bus's label are one identity in production, so a
	// test that renames has to start from the name the session came back with.
	fake.pi.setSessionName(name);
	registerTools(fake.pi, bus);
	const tool = fake.tools.get("session");
	if (!tool) throw new Error("session tool not registered");
	const ctx = fakeCtx({ cwd: root, sessionId: id, sessionName: name }).ctx as ExtensionContext;
	return { bus, ctx, tool, pi: fake.pi };
}

/** Naming is the join, so a session that must appear on the bus names itself. */
async function joins(target: Session): Promise<void> {
	await target.bus.start(target.ctx);
	await target.bus.rename(target.pi.getSessionName() ?? "session");
}

describe("session tool", () => {
	test("status lists both terminal sessions", async () => {
		const dir = busDir();
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await joins(frontend);
		await joins(backend);

		const result = await frontend.tool.execute("call", { action: "status" }, undefined, undefined, frontend.ctx);
		expect(result.details.status.sessions.map((item: { label: string }) => item.label).sort()).toEqual([
			"backend",
			"frontend",
		]);
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("send and inbox travel between sessions", async () => {
		const dir = busDir();
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

	test("claim conflicts are reported, not silently stolen", async () => {
		const dir = busDir();
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await frontend.bus.start(frontend.ctx);
		await backend.bus.start(backend.ctx);

		expect(
			(await frontend.tool.execute("call", { action: "claim", paths: ["src/api"] }, undefined, undefined, frontend.ctx))
				.details.claimed,
		).toEqual(["src/api"]);
		const conflict = await backend.tool.execute(
			"call",
			{ action: "claim", paths: ["src/api"] },
			undefined,
			undefined,
			backend.ctx,
		);
		expect(conflict.details.conflicts[0]).toMatchObject({ path: "src/api", ownerLabel: "frontend" });
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("watch arms, reports a turn-start notice, and stops", async () => {
		const dir = busDir();
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await frontend.bus.start(frontend.ctx);
		await backend.bus.start(backend.ctx);

		const armed = await backend.tool.execute("call", { action: "watch" }, undefined, undefined, backend.ctx);
		expect(armed.details.watching).toEqual({ armed: true, wake: false });
		expect(armed.content[0]?.text).toContain("next turn");

		await frontend.bus.send({ to: "backend", text: "is checkout.ts free?" });
		await backend.bus.poll();
		expect(backend.bus.pending().map((message) => message.fromLabel)).toEqual(["frontend"]);

		const stopped = await backend.tool.execute(
			"call",
			{ action: "watch", stop: true },
			undefined,
			undefined,
			backend.ctx,
		);
		expect(stopped.details.watching).toEqual({ armed: false, wake: false });
		expect(stopped.content[0]?.text).toContain("Inbox watch off");
		await frontend.bus.stop();
		await backend.bus.stop();
	});

	test("the watch transcript line says which mode is on", () => {
		const frontend = session(busDir(), "/repo/frontend", "s1", "frontend");
		const rendered = frontend.tool.renderResult(
			{ content: [], details: { action: "watch", watching: { armed: true, wake: true } } },
			{ expanded: false },
			fakeTheme,
		);
		expect(rendered.render(80).join("\n")).toContain("wakes a turn");
	});

	test("name sets the bus label and Pi's session name, and peers address it", async () => {
		const dir = busDir();
		const lead = session(dir, "/repo/mono", "s1", "mono");
		const owner = session(dir, "/repo/mono", "s2", "billing-core");
		await lead.bus.start(lead.ctx);
		await owner.bus.start(owner.ctx);

		const named = await lead.tool.execute(
			"call",
			{ action: "name", label: "  billing-lead  " },
			undefined,
			undefined,
			lead.ctx,
		);
		expect(named.isError).toBeUndefined();
		expect(named.details.label).toBe("billing-lead");
		expect(named.content[0]?.text).toBe('This session is now named "billing-lead".');
		expect(lead.pi.getSessionName()).toBe("billing-lead");

		const sent = await owner.tool.execute(
			"call",
			{ action: "send", to: "billing-lead", text: "config test is green" },
			undefined,
			undefined,
			owner.ctx,
		);
		expect(sent.details.delivered).toEqual(["billing-lead"]);
		const inbox = await lead.tool.execute("call", { action: "inbox" }, undefined, undefined, lead.ctx);
		expect(inbox.details.messages[0]).toMatchObject({ fromLabel: "billing-core", text: "config test is green" });
		await lead.bus.stop();
		await owner.bus.stop();
	});

	test("name refuses a label another live session holds", async () => {
		const dir = busDir();
		const lead = session(dir, "/repo/mono", "s1", "mono");
		const owner = session(dir, "/repo/mono", "s2", "billing-core");
		await lead.bus.start(lead.ctx);
		// Only the owner needs to be on the bus: the lead is naming itself into it.
		await joins(owner);

		const taken = await lead.tool.execute(
			"call",
			{ action: "name", label: "billing-core" },
			undefined,
			undefined,
			lead.ctx,
		);
		expect(taken.isError).toBe(true);
		expect(taken.content[0]?.text).toContain('the label "billing-core" is already in use');
		expect(lead.pi.getSessionName()).toBe("mono");
		await lead.bus.stop();
		await owner.bus.stop();
	});

	test("name refuses a blank label instead of keeping the old one", async () => {
		const dir = busDir();
		const lead = session(dir, "/repo/mono", "s1", "mono");
		await lead.bus.start(lead.ctx);

		const blank = await lead.tool.execute("call", { action: "name", label: "   " }, undefined, undefined, lead.ctx);
		expect(blank.isError).toBe(true);
		expect(blank.content[0]?.text).toContain("name requires a label");
		const status = await lead.tool.execute("call", { action: "status" }, undefined, undefined, lead.ctx);
		expect(status.details.status.me.label).toBe("mono");
		await lead.bus.stop();
	});

	test("the name transcript lines name the label", () => {
		const lead = session(busDir(), "/repo/mono", "s1", "mono");
		const call = lead.tool
			.renderCall({ action: "name", label: "billing-lead" }, fakeTheme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(call).toContain("session name billing-lead");
		const rendered = lead.tool.renderResult(
			{ content: [], details: { action: "name", label: "billing-lead" } },
			{ expanded: false },
			fakeTheme,
		);
		expect(rendered.render(80).join("\n")).toContain('Named this session "billing-lead"');
	});

	test("an invalid action returns a model-readable error", async () => {
		const dir = busDir();
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const result = await frontend.tool.execute("call", { action: "explode" }, undefined, undefined, frontend.ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("unknown action");
	});

	test("the transcript line neutralizes a peer label", () => {
		const frontend = session(busDir(), "/repo/frontend", "s1", "frontend");
		const rendered = frontend.tool.renderResult(
			{ content: [], details: { action: "send", delivered: ["back\u001b[31m\nend"] } },
			{ expanded: false },
			fakeTheme,
		);
		const out = rendered.render(80).join("\n");
		expect(out).not.toContain("\u001b");
		expect(out).toContain("Delivered to back [31m end");
	});

	test("the call line names the verb and what it acts on", () => {
		const frontend = session(busDir(), "/repo/frontend", "s1", "frontend");
		const send = frontend.tool
			.renderCall({ action: "send", to: "backend" }, fakeTheme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(send).toContain("session send backend");
		const claim = frontend.tool
			.renderCall({ action: "claim", paths: ["src/api", "src/http"] }, fakeTheme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(claim).toContain("session claim src/api +1");
		expect(
			frontend.tool
				.renderCall({ action: "claim", paths: ["src/api"] }, fakeTheme, { lastComponent: undefined })
				.render(20),
		).toHaveLength(1);
	});

	test("expanded status draws the sessions and the claims", () => {
		const frontend = session(busDir(), "/repo/frontend", "s1", "frontend");
		const rendered = frontend.tool.renderResult(
			{
				content: [],
				details: {
					action: "status",
					status: {
						me: { id: "s1", label: "frontend" },
						sessions: [
							{
								id: "s1",
								label: "frontend",
								cwd: "/repo/frontend",
								mode: "tui",
								unread: 0,
								pid: 1,
								repoRoot: "/repo",
								startedAt: 1,
								lastSeen: 2,
							},
							{
								id: "s2",
								label: "backend",
								cwd: "/repo/backend",
								mode: "tui",
								unread: 2,
								pid: 2,
								repoRoot: "/repo",
								startedAt: 1,
								lastSeen: 2,
							},
						],
						claims: [{ path: "src/api", owner: "s2", ownerLabel: "backend", at: 1 }],
						watching: { armed: true, wake: false },
					},
				},
			},
			{ expanded: true },
			fakeTheme,
		);
		const text = rendered.render(80).join("\n");
		expect(text).toContain("frontend · you");
		expect(text).toContain("2 unread · 1 claim");
		expect(text).toContain("Claims");
		expect(text).toContain("src/api");
		for (const width of [40, 80]) {
			for (const line of rendered.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	test("collapsed status counts in the plural and names the watch", () => {
		const frontend = session(busDir(), "/repo/frontend", "s1", "frontend");
		const rendered = frontend.tool.renderResult(
			{
				content: [],
				details: {
					action: "status",
					status: {
						me: { id: "s1", label: "frontend" },
						sessions: [
							{
								id: "s1",
								label: "frontend",
								cwd: "/r",
								mode: "tui",
								unread: 0,
								pid: 1,
								repoRoot: "/r",
								startedAt: 1,
								lastSeen: 2,
							},
						],
						claims: [],
						watching: { armed: true, wake: true },
					},
				},
			},
			{ expanded: false },
			fakeTheme,
		);
		expect(rendered.render(80).join("\n")).toContain("1 session · 0 claims · watch wake");
	});

	test("expanded inbox lists what was consumed", () => {
		const frontend = session(busDir(), "/repo/frontend", "s1", "frontend");
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

	test("a release names the paths it did not own instead of a green success", () => {
		const frontend = session(busDir(), "/repo/frontend", "s1", "frontend");
		const rendered = frontend.tool.renderResult(
			{ content: [], details: { action: "release", released: ["src/ok.ts"], notOwned: ["src/theirs.ts"] } },
			{ expanded: false },
			fakeTheme,
		);
		const text = rendered.render(80).join("\n");
		expect(text).toContain("Released src/ok.ts");
		expect(text).toContain("Not yours: src/theirs.ts");
	});

	test("empty results never print a bare success", () => {
		const frontend = session(busDir(), "/repo/frontend", "s1", "frontend");
		const line = (details: unknown): string =>
			frontend.tool.renderResult({ content: [], details }, { expanded: false }, fakeTheme).render(80).join("\n");
		expect(line({ action: "send", delivered: [] })).toContain("Delivered to nobody");
		expect(line({ action: "claim", claimed: [], conflicts: [] })).toContain("Claimed nothing");
	});
});
