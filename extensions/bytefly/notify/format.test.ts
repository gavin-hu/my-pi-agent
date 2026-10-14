import { describe, expect, test } from "bun:test";
import type { JobFinishedEvent } from "../../../lib/events.ts";
import { formatInputBody, formatJobBody, formatTurnBody, sessionLabel } from "./format.ts";

const job = (overrides: Partial<JobFinishedEvent> = {}): JobFinishedEvent => ({
	id: "j1",
	label: "build",
	status: "exited",
	exitCode: 0,
	signal: null,
	...overrides,
});

describe("sessionLabel", () => {
	test("prefers a sanitized session name", () => {
		expect(sessionLabel("feature\trefactor", "/home/u/repo/project")).toBe("feature refactor");
	});

	test("falls back to the cwd folder name", () => {
		expect(sessionLabel(undefined, "/home/u/repo/project")).toBe("project");
	});

	test("strips a trailing separator before taking the folder", () => {
		expect(sessionLabel("", "/home/u/repo/project/")).toBe("project");
	});

	test("falls back to session when there is no folder", () => {
		expect(sessionLabel(undefined, "/")).toBe("session");
	});
});

describe("formatTurnBody", () => {
	test("names the session", () => {
		expect(formatTurnBody("project")).toBe("Turn finished · project");
	});
});

describe("formatInputBody", () => {
	test("includes the prompt title", () => {
		expect(formatInputBody("select", "Deploy where?", "project")).toBe(
			"Waiting for input (select): Deploy where? · project",
		);
	});

	test("omits the title when there is none", () => {
		expect(formatInputBody("confirm", undefined, "project")).toBe("Waiting for input (confirm) · project");
	});
});

describe("formatJobBody", () => {
	test("a clean exit reads as finished", () => {
		expect(formatJobBody(job())).toBe("Job j1 finished · build");
	});

	test("a failure carries the exit code", () => {
		expect(formatJobBody(job({ status: "failed", exitCode: 2 }))).toBe("Job j1 failed (2) · build");
	});

	test("a kill reads as killed", () => {
		expect(formatJobBody(job({ status: "killed", exitCode: null, signal: "SIGTERM" }))).toBe(
			"Job j1 was killed · build",
		);
	});

	test("an unobservable end reads as finished with no code", () => {
		expect(formatJobBody(job({ status: "unknown", exitCode: null }))).toBe("Job j1 finished · build");
	});

	test("omits an empty label", () => {
		expect(formatJobBody(job({ label: "  " }))).toBe("Job j1 finished");
	});
});
