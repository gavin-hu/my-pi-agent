/**
 * The `session` tool's harness: a bus in a temp directory, a `FakePi` carrying it, and the
 * tool registered the way Pi registers it.
 *
 * Two suites call that tool — the surface's own, and the one that pins what an inbox read
 * costs in the model's context — and a session built twice would be a session built two
 * ways. Pi's session name and the bus's label are one identity in production, so the pair
 * is built here once: a case that joins starts from the name the session came back with.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSessionBus, type SessionBus } from "../../../extensions/session-bus/runtime.ts";
import { registerTools } from "../../../extensions/session-bus/tools.ts";
import { fakeCtx } from "../context.ts";
import { createFakePi } from "../fakes.ts";

/** The Pi surface the tool writes a label through, and reads one back from. */
export interface SessionNameSurface {
	getSessionName(): string | undefined;
	setSessionName(name: string): void;
}

/** The `session` tool as the host holds it: every entry point a suite drives or renders. */
export interface SessionTool {
	execute(
		id: string,
		params: unknown,
		signal?: undefined,
		update?: undefined,
		ctx?: ExtensionContext,
	): Promise<{ content: Array<{ text: string }>; details: any; isError?: true }>;
	renderCall(args: unknown, theme: unknown, context?: { lastComponent?: unknown }): { render(width: number): string[] };
	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details: unknown },
		options: { expanded: boolean },
		theme: unknown,
		context?: { lastComponent?: unknown },
	): { render(width: number): string[] };
}

export interface BusToolSession {
	bus: SessionBus;
	ctx: ExtensionContext;
	pi: SessionNameSurface;
	tool: SessionTool;
}

/** One session on a bus of its own directory, named as Pi names it. */
export function busToolSession(dir: string, root: string, id: string, name: string): BusToolSession {
	const bus = createSessionBus({} as ExtensionAPI, {
		dir,
		repo: { root, key: "shared" },
		now: () => 1_000,
		heartbeatMs: 0,
	});
	const fake = createFakePi();
	fake.pi.setSessionName(name);
	registerTools(fake.pi, bus);
	const tool = fake.tools.get("session");
	if (!tool) throw new Error("session tool not registered");
	const ctx = fakeCtx({ cwd: root, sessionId: id, sessionName: name }).ctx as ExtensionContext;
	return { bus, ctx, tool: tool as SessionTool, pi: fake.pi };
}

/** Joining puts a session on the bus, so a case that needs a peer joins it. */
export async function joinBusSession(target: BusToolSession): Promise<void> {
	await target.bus.start(target.ctx);
	await target.bus.join({ label: target.pi.getSessionName() ?? "session", listen: false });
}
