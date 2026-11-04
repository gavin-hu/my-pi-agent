/**
 * What a peer session tells its extensions on the way out, and who waits for them.
 *
 * `AgentSession.dispose()` does not emit `session_shutdown` — only the runtime
 * teardown does, and a peer session has no runtime — so a peer that disposed
 * quietly stranded whatever its extensions opened in `session_start`: serve's
 * socket, file-browse's page server, web-access's cache, job and watch children,
 * one more set on every idle sweep until the host exited.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { tempDir } from "../../../test/helpers/env.ts";
import { settle } from "../../../test/helpers/process.ts";
import { openPeerSession } from "./peer-session.ts";
import { createPeerWorker } from "./peer-worker.ts";

const peer = "o9cq805LvMzHEsv0mfq0XwZPJruI@im.wechat";

/** A session that records what its extension runner is told, and when. */
function sessionWith(handlers: boolean): {
	session: AgentSession;
	events: () => Array<{ type: string; reason?: string }>;
	order: () => string[];
} {
	const events: Array<{ type: string; reason?: string }> = [];
	const order: string[] = [];
	const session = {
		bindExtensions: async () => {},
		getActiveToolNames: () => [],
		getAllTools: () => [],
		setActiveToolsByName: () => {},
		extensionRunner: {
			hasHandlers: () => handlers,
			emit: async (event: { type: string; reason?: string }) => {
				events.push(event);
				order.push(event.type);
			},
		},
		dispose: () => void order.push("dispose"),
	};
	return {
		session: session as unknown as AgentSession,
		events: () => [...events],
		order: () => [...order],
	};
}

/** Open a peer on a session double, with no real resources loaded. */
async function openOn(session: AgentSession): Promise<Awaited<ReturnType<typeof openPeerSession>>> {
	const root = tempDir("wechat-disposal-");
	return await openPeerSession(peer, {
		cwd: root,
		agentDir: root,
		sessionsDir: join(root, "sessions"),
		uiContext: {} as never,
		seams: {
			create: async () => ({ session }) as never,
			loader: (() => ({ reload: async () => {} })) as never,
		},
	});
}

describe("peer session disposal", () => {
	test("tells the peer's extensions the session ended, before the session goes", async () => {
		const fake = sessionWith(true);
		const opened = await openOn(fake.session);

		await opened.dispose();

		expect(fake.events()).toEqual([{ type: "session_shutdown", reason: "quit" }]);
		// A handler still sees a live session: the event comes first, the disposal second.
		expect(fake.order()).toEqual(["session_shutdown", "dispose"]);
	});

	test("disposes a session whose extensions handle no shutdown", async () => {
		const fake = sessionWith(false);
		const opened = await openOn(fake.session);

		await opened.dispose();

		expect(fake.events()).toEqual([]);
		expect(fake.order()).toEqual(["dispose"]);
	});
});

describe("peer worker disposal", () => {
	test("a close waits for the session's extensions to let go", async () => {
		let release: (() => void) | undefined;
		const order: string[] = [];
		const worker = createPeerWorker({
			openSession: async () =>
				({
					session: {
						getLastAssistantText: () => "",
						subscribe: () => () => {},
						async prompt(): Promise<void> {},
						async abort(): Promise<void> {},
					} as never,
					async dispose(): Promise<void> {
						order.push("letting go");
						await new Promise<void>((resolve) => {
							release = resolve;
						});
						order.push("gone");
					},
				}) as never,
			send: async () => true,
			fallback: (_target, reason) => `fallback:${reason}`,
			idleTimeoutMs: 0,
		});
		worker.enqueue({ peer, text: "hi", language: "en" });
		await settle();
		let settled = false;
		const closing = worker.close().then(() => {
			settled = true;
		});
		await settle();
		// Settlement, not the order: a close that never waited still leaves the disposal running,
		// so `order` alone reads the same whether it waited or not.
		expect({ settled, order }).toEqual({ settled: false, order: ["letting go"] });

		release?.();
		await closing;
		expect(order).toEqual(["letting go", "gone"]);
	});
});
