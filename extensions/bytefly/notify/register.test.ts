import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { JOB_FINISHED_CHANNEL, WATCH_MATCH_CHANNEL } from "../../../lib/events.ts";
import { withAgentDir } from "../../../test/helpers/env.ts";
import { createFakePi, emit } from "../../../test/helpers/fakes.ts";
import { fakeFooterCtx } from "../../../test/helpers/fixtures/bytefly.ts";
import type { NotifySeams } from "./dispatch.ts";
import { registerNotify } from "./register.ts";

interface Harness {
	pi: any;
	ctx: any;
	written: string[];
	ran: Array<{ command: string; args: string[] }>;
	/** The capability's handle, for the paths another bytefly module drives. */
	handle: { notify: (body: string) => void };
}

const finished = { id: "j1", label: "build", status: "exited", exitCode: 0, signal: null };

/**
 * Register the capability over a recording seams with `notify` in `bytefly.json`,
 * start the session, and hand the live harness to `fn`. Everything runs inside
 * the temp agent directory, because `session_start` reads the config from it.
 */
async function scenario(notify: Record<string, unknown> | undefined, fn: (h: Harness) => Promise<void>): Promise<void> {
	await withAgentDir(async (agentDir) => {
		if (notify) writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ notify }));
		const written: string[] = [];
		const ran: Array<{ command: string; args: string[] }> = [];
		const seams: NotifySeams = {
			platform: "linux",
			env: {},
			stdout: {
				write: (chunk) => {
					written.push(chunk);
					return true;
				},
				isTTY: true,
			},
			run: (command, args) => ran.push({ command, args }),
		};
		const { pi } = createFakePi();
		const ctx = fakeFooterCtx({ mode: "tui", sessionName: "project" }).ctx;
		const handle = registerNotify(pi, { seams });
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await fn({ pi, ctx, written, ran, handle });
	});
}

describe("registerNotify — turn finished", () => {
	test("notifies once a run settles", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "agent_settled", { aborted: false }, h.ctx);
			expect(h.written).toEqual(["\x1b]777;notify;Pi;Turn finished · project\x07"]);
		});
	});

	test("stays silent when the run was aborted", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "agent_settled", { aborted: true }, h.ctx);
			expect(h.written).toEqual([]);
		});
	});

	test("honors turnFinished: false", async () => {
		await scenario({ enabled: true, method: "osc777", turnFinished: false }, async (h) => {
			await emit(h.pi, "agent_settled", { aborted: false }, h.ctx);
			expect(h.written).toEqual([]);
		});
	});

	test("stays silent while the capability is off", async () => {
		await scenario({ enabled: false, method: "osc777" }, async (h) => {
			await emit(h.pi, "agent_settled", { aborted: false }, h.ctx);
			expect(h.written).toEqual([]);
		});
	});
});

describe("registerNotify — needs input", () => {
	test("notifies for a prompt opened during a run", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "agent_start", {}, h.ctx);
			await emit(h.pi, "ui_prompt_start", { kind: "select", title: "Deploy where?" }, h.ctx);
			expect(h.written).toEqual(["\x1b]777;notify;Pi;Waiting for input (select): Deploy where? · project\x07"]);
		});
	});

	test("stays silent for a prompt while idle", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "ui_prompt_start", { kind: "custom", title: "Extensions" }, h.ctx);
			expect(h.written).toEqual([]);
		});
	});

	test("stops treating a run as active once it settles", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "agent_start", {}, h.ctx);
			await emit(h.pi, "agent_settled", { aborted: false }, h.ctx);
			await emit(h.pi, "ui_prompt_start", { kind: "confirm", title: "Again?" }, h.ctx);
			expect(h.written).toHaveLength(1);
		});
	});
});

describe("registerNotify — background jobs", () => {
	test("notifies when the job extension announces a completion", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			h.pi.events.emit(JOB_FINISHED_CHANNEL, finished);
			expect(h.written).toEqual(["\x1b]777;notify;Pi;Job j1 finished · build\x07"]);
		});
	});

	test("honors jobFinished: false", async () => {
		await scenario({ enabled: true, method: "osc777", jobFinished: false }, async (h) => {
			h.pi.events.emit(JOB_FINISHED_CHANNEL, finished);
			expect(h.written).toEqual([]);
		});
	});

	test("ignores a malformed payload", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			h.pi.events.emit(JOB_FINISHED_CHANNEL, { id: "j1" });
			expect(h.written).toEqual([]);
		});
	});

	test("does not double-subscribe across a reload", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "session_start", { reason: "reload" }, h.ctx);
			h.pi.events.emit(JOB_FINISHED_CHANNEL, finished);
			expect(h.written).toHaveLength(1);
		});
	});

	test("drops the subscription on shutdown", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "session_shutdown", { reason: "quit" }, h.ctx);
			h.pi.events.emit(JOB_FINISHED_CHANNEL, finished);
			expect(h.written).toEqual([]);
		});
	});
});

describe("registerNotify — watch matches", () => {
	const match = { count: 2, watcherId: "w3", label: "build", line: "error: bad thing" };

	test("notifies when the watch extension announces a wake match", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			h.pi.events.emit(WATCH_MATCH_CHANNEL, match);
			expect(h.written).toEqual(["\x1b]777;notify;Pi;2 watched lines matched · w3 build: error: bad thing\x07"]);
		});
	});

	test("honors matchFound: false without touching the other triggers", async () => {
		await scenario({ enabled: true, method: "osc777", matchFound: false }, async (h) => {
			h.pi.events.emit(WATCH_MATCH_CHANNEL, match);
			expect(h.written).toEqual([]);

			h.pi.events.emit(JOB_FINISHED_CHANNEL, finished);
			expect(h.written).toHaveLength(1);
		});
	});

	test("stays silent while notifications are off", async () => {
		await scenario({ enabled: false, method: "osc777" }, async (h) => {
			h.pi.events.emit(WATCH_MATCH_CHANNEL, match);
			expect(h.written).toEqual([]);
		});
	});

	test("ignores a malformed payload", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			h.pi.events.emit(WATCH_MATCH_CHANNEL, { count: 1, watcherId: "w1" });
			expect(h.written).toEqual([]);
		});
	});

	test("drops the subscription on shutdown", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "session_shutdown", { reason: "quit" }, h.ctx);
			h.pi.events.emit(WATCH_MATCH_CHANNEL, match);
			expect(h.written).toEqual([]);
		});
	});
});

describe("registerNotify — the handle", () => {
	test("sends one notification with the configured title when enabled", async () => {
		await scenario({ enabled: true, method: "osc777", title: "Build" }, async (h) => {
			h.handle.notify("Session budget reached · ¥1.00 of ¥1.00");
			expect(h.written).toEqual(["\x1b]777;notify;Build;Session budget reached · ¥1.00 of ¥1.00\x07"]);
		});
	});

	test("is inert while notifications are off", async () => {
		await scenario({ enabled: false, method: "osc777" }, async (h) => {
			h.handle.notify("Session budget reached");
			expect(h.written).toEqual([]);
		});
	});
});
