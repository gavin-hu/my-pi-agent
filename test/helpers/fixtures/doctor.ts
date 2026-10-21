/**
 * Doctor test harness.
 *
 * Builds bytefly's doctor surface over the shared `ExtensionAPI` double and an
 * injected runtime, so every probe is a fake result: no test spawns a binary,
 * loads an optional package, or touches the real agent directory.
 *
 * `loadModule` and `invocation` default to satisfied stubs for the same reason;
 * the real wiring for those two seams is covered by `lib/requirements.test.ts`.
 */

import { registerDoctor } from "../../../extensions/bytefly/doctor/register.ts";
import {
	createDoctorRuntime,
	type DoctorRuntime,
	type DoctorSeamOverrides,
} from "../../../extensions/bytefly/doctor/runtime.ts";
import type { ExtensionReport, Finding, FindingSeverity } from "../../../lib/requirements.ts";
import { fakeCtx } from "../context.ts";
import { createFakePi, emit, type FakePi, type FakePiOptions } from "../fakes.ts";
import { settle } from "../process.ts";

export interface DoctorHarness {
	fake: FakePi;
	ctx: any;
	notices: Array<{ message: string; kind?: string }>;
	notifications: string[];
	runtime: DoctorRuntime;
	/** Fire `session_start` with the harness context. */
	start(): Promise<void>;
	/** Fire `session_shutdown`. */
	stop(): Promise<void>;
}

export interface DoctorBootOptions {
	/** `exec` double; a clean exit for every probe by default. */
	exec?: FakePiOptions["exec"];
	seams?: DoctorSeamOverrides;
	/** Effective Pi settings, for the quiet-startup gate. */
	settings?: unknown;
	mode?: string;
	hasUI?: boolean;
	cwd?: string;
}

/** Boot bytefly's doctor surface against fake seams. */
export function bootDoctor(options: DoctorBootOptions = {}): DoctorHarness {
	const fake = createFakePi({
		exec: options.exec ?? (async () => ({ stdout: "", stderr: "", code: 0 })),
		settings: options.settings,
	});
	const runtime = createDoctorRuntime(fake.pi, {
		seams: {
			loadModule: async () => ({}),
			invocation: () => ({ command: process.execPath, args: ["pi", "--version"] }),
			...options.seams,
		},
	});
	registerDoctor(fake.pi, { runtime });

	const session = fakeCtx({ mode: options.mode ?? "tui", hasUI: options.hasUI, cwd: options.cwd ?? "/repo" });
	return {
		fake,
		ctx: session.ctx,
		notices: session.notices,
		notifications: session.notifications,
		runtime,
		start: async () => {
			await emit(fake.pi, "session_start", { reason: "startup" }, session.ctx);
			// The handler fires the probe without awaiting it, so let that chain finish
			// before a caller asserts on what it posted.
			await settle();
		},
		stop: () => emit(fake.pi, "session_shutdown", { reason: "quit" }, session.ctx),
	};
}

/** An `exec` double that fails every probe. */
export const failingExec = async () => ({ stdout: "", stderr: "", code: 127 });

/** Build one finding for a report fixture. */
export function makeFinding(
	check: string,
	severity: FindingSeverity,
	detail = `${check} detail`,
	hint?: string,
): Finding {
	return hint === undefined
		? { extension: "file-read", check, severity, detail }
		: { extension: "file-read", check, severity, detail, hint };
}

/** Build one extension report. */
export function makeReport(extension: string, findings: Finding[] = [], enabled = true): ExtensionReport {
	return { extension, enabled, findings: findings.map((finding) => ({ ...finding, extension })) };
}
