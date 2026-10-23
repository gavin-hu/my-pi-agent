import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
	tool: {
		execute(
			id: string,
			params: unknown,
			signal?: undefined,
			update?: undefined,
			ctx?: ExtensionContext,
		): Promise<{ content: Array<{ text: string }>; details: any; isError?: true }>;
		renderResult(
			result: { content: Array<{ type: string; text?: string }>; details: unknown },
			options: { expanded: boolean },
			theme: unknown,
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
	registerTools(fake.pi, bus);
	const tool = fake.tools.get("session");
	if (!tool) throw new Error("session tool not registered");
	const ctx = fakeCtx({ cwd: root, sessionId: id, sessionName: name }).ctx as ExtensionContext;
	return { bus, ctx, tool };
}

describe("session tool", () => {
	test("status lists both terminal sessions", async () => {
		const dir = busDir();
		const frontend = session(dir, "/repo/frontend", "s1", "frontend");
		const backend = session(dir, "/repo/backend", "s2", "backend");
		await frontend.bus.start(frontend.ctx);
		await backend.bus.start(backend.ctx);

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
		await frontend.bus.start(frontend.ctx);
		await backend.bus.start(backend.ctx);

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
});
