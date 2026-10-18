import { describe, expect, test } from "bun:test";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { updateMarker, updateNotice } from "./format.ts";

describe("updateMarker", () => {
	test("is the shared up arrow and the version, with no gap", () => {
		expect(updateMarker("0.12.0")).toBe(`${GLYPHS.update}0.12.0`);
	});
});

describe("updateNotice", () => {
	const notice = updateNotice("0.11.4", "0.12.0");

	test("is the shared notice type, shown in the transcript", () => {
		expect(notice.customType).toBe(NOTICE_TYPE);
		expect(notice.display).toBe(true);
	});

	test("tells the model both versions and the command, in plain text", () => {
		expect(notice.content).toContain("bytefly 0.12.0 is available");
		expect(notice.content).toContain("current 0.11.4");
		expect(notice.content).toContain("pi update --extensions");
	});

	test("is an informational block, not a fault", () => {
		expect(notice.details.source).toBe("bytefly");
		expect(notice.details.title).toBe("0.12.0 is available");
		expect(notice.details.severity).toBe("info");
	});

	test("carries the loaded version and the fixing command as rows", () => {
		expect(notice.details.items).toEqual([
			{ label: "current", detail: "v0.11.4" },
			{ label: "update", detail: "pi update --extensions" },
		]);
	});
});
