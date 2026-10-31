/**
 * What a session start no longer waits for: the channel's load, and who waits instead.
 *
 * `registerPendingChannel` starts a runtime's scan and returns, so the reload is not spent on
 * records nobody has read yet. The other half is the contract these cases hold: the report
 * trigger is armed when the scan lands, the first turn is the reader that waits for it, and a
 * failed scan surfaces there rather than as an unhandled rejection inside a reload.
 */

import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFakePi, emit, emitFirst } from "../test/helpers/fakes.ts";
import { registerPendingChannel } from "./report.ts";

const ctx = {} as ExtensionContext;

/** A reporter that records each hook it is asked for, with no notice waiting. */
function quietReporter(log: string[]) {
	return {
		report: () => log.push("report"),
		sessionStart: () => log.push("sessionStart"),
		agentStart: () => log.push("agentStart"),
		agentSettled: () => log.push("agentSettled"),
		beforeAgentStart: () => {
			log.push("beforeAgentStart");
			return undefined;
		},
		filterContext: () => undefined,
	};
}

/** A gate this suite settles by hand, so "still landing" is asserted instead of raced. */
function gate(): { landed: Promise<void>; release: () => void } {
	let release: () => void = () => {};
	const landed = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { landed, release };
}

describe("the load a channel starts", () => {
	test("the session start returns while the load is landing, and the first turn waits", async () => {
		const log: string[] = [];
		const { pi } = createFakePi();
		const scan = gate();
		registerPendingChannel(pi, {
			reporter: quietReporter(log),
			runtime: {
				load: async () => {
					await scan.landed;
					log.push("load");
				},
				shutdown: async () => {
					log.push("shutdown");
				},
			},
			onSessionStart: () => log.push("arm"),
		});

		await emit(pi, "session_start", {}, ctx);
		expect(log).toEqual(["sessionStart"]);

		const turn = emitFirst(pi, "before_agent_start", {}, ctx);
		scan.release();
		await turn;
		// The scan landed before the reader, and the trigger was armed before it reported.
		expect(log).toEqual(["sessionStart", "load", "arm", "beforeAgentStart"]);
	});

	test("a load that fails arms anyway and surfaces at the first read", async () => {
		const log: string[] = [];
		const { pi } = createFakePi();
		registerPendingChannel(pi, {
			reporter: quietReporter(log),
			runtime: {
				load: async () => {
					throw new Error("the registry is unreadable");
				},
				shutdown: async () => {
					log.push("shutdown");
				},
			},
			// A failed scan must not mute a reporter that has something else to say.
			onSessionStart: () => log.push("arm"),
		});

		await emit(pi, "session_start", {}, ctx);
		await expect(emitFirst(pi, "before_agent_start", {}, ctx)).rejects.toThrow("the registry is unreadable");
		expect(log).toEqual(["sessionStart", "arm"]);
	});

	test("a shutdown waits for a load still landing, then releases", async () => {
		const log: string[] = [];
		const { pi } = createFakePi();
		const scan = gate();
		registerPendingChannel(pi, {
			reporter: quietReporter(log),
			runtime: {
				load: async () => {
					await scan.landed;
					log.push("load");
				},
				shutdown: async () => {
					log.push("shutdown");
				},
			},
			onSessionShutdown: () => log.push("disarm"),
		});

		await emit(pi, "session_start", {}, ctx);
		const stopping = emit(pi, "session_shutdown", {}, ctx);
		scan.release();
		await stopping;
		// The runtime is released after its scan, and the trigger is disarmed before it.
		expect(log).toEqual(["sessionStart", "load", "disarm", "shutdown"]);
	});
});
