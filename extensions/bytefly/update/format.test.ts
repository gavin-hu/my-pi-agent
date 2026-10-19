import { describe, expect, test } from "bun:test";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { releaseUrl, updateMarker, updateNotice, updateOutcomeText } from "./format.ts";
import type { PackageUpdate } from "./types.ts";

const OWN: PackageUpdate = {
	source: "@gavin-hu/my-pi-agent",
	displayName: "@gavin-hu/my-pi-agent",
	type: "npm",
	scope: "user",
};
const OTHER: PackageUpdate = {
	source: "github.com/example/tool",
	displayName: "example/tool",
	type: "git",
	scope: "project",
};
const RELEASE = "https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.14.0";

describe("updateMarker", () => {
	test("is the shared up arrow and the version, with no gap", () => {
		expect(updateMarker("0.14.0")).toBe(`${GLYPHS.update}0.14.0`);
	});
});

describe("updateNotice", () => {
	test("is the shared notice type, shown in the transcript", () => {
		const notice = updateNotice([OWN], "0.12.0", "0.14.0");
		expect(notice.customType).toBe(NOTICE_TYPE);
		expect(notice.display).toBe(true);
	});

	test("tells the model the packages, the version arrow, the command, and the release", () => {
		const notice = updateNotice([OWN, OTHER], "0.12.0", "0.14.0");

		expect(notice.content).toContain("2 package updates available");
		expect(notice.content).toContain("@gavin-hu/my-pi-agent");
		expect(notice.content).toContain("example/tool");
		expect(notice.content).toContain("v0.12.0 → v0.14.0");
		expect(notice.content).toContain("pi update --extensions");
		expect(notice.content).toContain(RELEASE);
	});

	test("is an informational block, not a fault", () => {
		const notice = updateNotice([OWN], "0.12.0", "0.14.0");
		expect(notice.details.source).toBe("bytefly");
		expect(notice.details.title).toBe("1 package update available");
		expect(notice.details.severity).toBe("info");
	});

	test("carries one row per package, the command, and the release", () => {
		const notice = updateNotice([OWN, OTHER], "0.12.0", "0.14.0");

		expect(notice.details.items).toEqual([
			{ label: "@gavin-hu/my-pi-agent", detail: "v0.12.0 → v0.14.0", severity: "info" },
			{ label: "example/tool", detail: "project", severity: "info" },
			{ label: "update", detail: "pi update --extensions" },
			{ label: "release", detail: RELEASE },
		]);
	});

	test("drops the version and release when this package's version is unknown", () => {
		const notice = updateNotice([OWN, OTHER], "0.12.0");

		expect(notice.details.items).toEqual([
			{ label: "@gavin-hu/my-pi-agent", detail: "global", severity: "info" },
			{ label: "example/tool", detail: "project", severity: "info" },
			{ label: "update", detail: "pi update --extensions" },
		]);
	});
});

describe("releaseUrl", () => {
	test("points at the tag page for the version", () => {
		expect(releaseUrl("0.14.0")).toBe(RELEASE);
	});
});

describe("updateOutcomeText", () => {
	test("reports a skip when offline", () => {
		expect(updateOutcomeText({ kind: "offline" }, "0.12.0")).toEqual({
			text: "bytefly: the update check was skipped (PI_OFFLINE is set).",
			severity: "info",
		});
	});

	test("reports an unreadable list as a warning", () => {
		const outcome = updateOutcomeText({ kind: "failed" }, "0.12.0");
		expect(outcome.severity).toBe("warning");
		expect(outcome.text).toContain("could not check package updates");
	});

	test("reports an up-to-date session", () => {
		expect(updateOutcomeText({ kind: "current" }, "0.12.0")).toEqual({
			text: "bytefly: up to date — no configured package has an update.",
			severity: "info",
		});
	});

	test("reports an available package list with this package's version and release", () => {
		const outcome = updateOutcomeText({ kind: "available", updates: [OWN, OTHER], ownLatest: "0.14.0" }, "0.12.0");
		expect(outcome.severity).toBe("info");
		expect(outcome.text).toContain("2 package updates available");
		expect(outcome.text).toContain("@gavin-hu/my-pi-agent");
		expect(outcome.text).toContain("example/tool");
		expect(outcome.text).toContain("v0.12.0 → v0.14.0");
		expect(outcome.text).toContain(RELEASE);
	});

	test("reports another package without inventing this package's version", () => {
		const outcome = updateOutcomeText({ kind: "available", updates: [OTHER] }, "0.12.0");
		expect(outcome.text).not.toContain("This package");
		expect(outcome.text).not.toContain(RELEASE);
		expect(outcome.text).toContain("example/tool");
	});
});
