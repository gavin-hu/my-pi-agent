import { describe, expect, test } from "bun:test";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { releaseUrl, updateMarker, updateNotice, updateOutcomeText } from "./format.ts";

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

	test("carries the loaded version, the fixing command, and the release URL as rows", () => {
		expect(notice.details.items).toEqual([
			{ label: "current", detail: "v0.11.4" },
			{ label: "update", detail: "pi update --extensions" },
			{ label: "release", detail: "https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.12.0" },
		]);
	});

	test("names the release URL in the text the model reads", () => {
		expect(notice.content).toContain("https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.12.0");
	});
});

describe("releaseUrl", () => {
	test("points at the tag page for the version", () => {
		expect(releaseUrl("0.12.0")).toBe("https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.12.0");
	});
});

describe("updateOutcomeText", () => {
	test("reports a skip when offline", () => {
		expect(updateOutcomeText({ kind: "offline" }, "0.12.0")).toEqual({
			text: "bytefly: the update check was skipped (PI_OFFLINE is set).",
			severity: "info",
		});
	});

	test("reports an unreadable registry as a warning", () => {
		const outcome = updateOutcomeText({ kind: "failed" }, "0.12.0");
		expect(outcome.severity).toBe("warning");
		expect(outcome.text).toContain("could not read the published version");
	});

	test("reports the newest version when nothing is newer", () => {
		expect(updateOutcomeText({ kind: "current", latest: "0.12.0" }, "0.12.0")).toEqual({
			text: "bytefly: up to date — v0.12.0 is the newest published version.",
			severity: "info",
		});
	});

	test("reports an available version with its release URL", () => {
		const outcome = updateOutcomeText({ kind: "available", latest: "0.13.0" }, "0.12.0");
		expect(outcome.severity).toBe("info");
		expect(outcome.text).toContain("v0.13.0 is available (current 0.12.0)");
		expect(outcome.text).toContain("https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.13.0");
	});
});
