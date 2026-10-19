import { describe, expect, test } from "bun:test";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { UPDATE_COMMAND, updateMarker, updateNotice } from "./format.ts";
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

describe("updateMarker", () => {
	test("is the shared up arrow and this package's version, with no gap", () => {
		expect(updateMarker("0.14.0")).toBe(`${GLYPHS.update}0.14.0`);
	});
});

describe("updateNotice", () => {
	test("is the shared notice type, shown in the transcript", () => {
		const notice = updateNotice([OWN]);
		expect(notice.customType).toBe(NOTICE_TYPE);
		expect(notice.display).toBe(true);
	});

	test("tells the model the package and the command, in plain text", () => {
		const notice = updateNotice([OWN]);

		expect(notice.content).toContain("1 package update available");
		expect(notice.content).toContain("@gavin-hu/my-pi-agent");
		expect(notice.content).toContain(UPDATE_COMMAND);
	});

	test("counts every package in the headline", () => {
		expect(updateNotice([OWN, OTHER]).details.title).toBe("2 package updates available");
		expect(updateNotice([OWN, OTHER]).content).toContain("example/tool");
	});

	test("carries one row per package and the fixing command", () => {
		const notice = updateNotice([OWN, OTHER]);

		expect(notice.details.source).toBe("bytefly");
		expect(notice.details.severity).toBe("info");
		expect(notice.details.items).toEqual([
			{ label: "@gavin-hu/my-pi-agent", detail: "global", severity: "info" },
			{ label: "example/tool", detail: "project", severity: "info" },
			{ label: "update", detail: UPDATE_COMMAND },
		]);
	});
});
