import { describe, expect, test } from "bun:test";
import { notice, type NoticeKind } from "./notices.ts";

describe("notice", () => {
	// Every kind the bridge can send, so a new one is covered by these checks.
	const KINDS: NoticeKind[] = [
		"ack",
		"busy",
		"stillWorking",
		"overflow",
		"media",
		"unsupported",
		"stopped",
		"noText",
		"compacted",
		"budget",
		"timeout",
		"failed",
		"newBusy",
	];

	test("renders the peer's language only", () => {
		const cjk = /[\u3400-\u4dbf\u4e00-\u9fff]/;
		for (const kind of KINDS) {
			expect(cjk.test(notice(kind, "zh"))).toBe(true);
			expect(cjk.test(notice(kind, "en"))).toBe(false);
		}
	});

	test("fills in a count", () => {
		expect(notice("media", "en", 2)).toBe("Couldn't open 2 attachment(s) — please resend or describe it.");
		expect(notice("media", "zh", 2)).toContain("2 个附件");
	});

	test("keeps every notice to one line", () => {
		for (const kind of KINDS) {
			for (const lang of ["en", "zh"] as const) expect(notice(kind, lang)).not.toContain("\n");
		}
	});
});
