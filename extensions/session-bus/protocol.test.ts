import { describe, expect, test } from "bun:test";
import {
	claimsConflict,
	defaultLabel,
	normalizeAction,
	normalizeKind,
	normalizeLabel,
	normalizeLimit,
	normalizePaths,
	normalizeText,
	resolveRecipients,
	sessionMode,
	shortId,
} from "./protocol.ts";

describe("labels and actions", () => {
	test("normalizes a label and falls back when empty", () => {
		expect(normalizeLabel("  front\tend  ", "session")).toBe("front end");
		expect(normalizeLabel("   ", "session")).toBe("session");
	});
	test("uses the cwd basename as the default label", () => {
		expect(defaultLabel(undefined, "/repo/frontend", "s1")).toBe("frontend");
		expect(defaultLabel("named", "/repo/frontend", "s1")).toBe("named");
	});
	test("shortens an id for display", () => {
		expect(shortId("abcdef123456")).toBe("123456");
	});
	test("accepts only known actions and kinds", () => {
		expect(normalizeAction("send")).toBe("send");
		expect(normalizeAction("nope")).toBeUndefined();
		expect(normalizeKind(undefined)).toBe("message");
		expect(normalizeKind("handoff")).toBe("handoff");
	});
	test("records the session mode, and unknown for anything else", () => {
		expect(["tui", "rpc", "json", "print"].map((mode) => sessionMode(mode))).toEqual(["tui", "rpc", "json", "print"]);
		expect(sessionMode("wechat")).toBe("unknown");
		expect(sessionMode(undefined)).toBe("unknown");
	});
});

describe("validation", () => {
	test("trims text and enforces the limit", () => {
		expect(normalizeText("  hello  ")).toEqual({ text: "hello" });
		expect(normalizeText("   ")).toEqual({ error: "text is required." });
		expect(normalizeText("x".repeat(4_001))).toHaveProperty("error");
	});
	test("clamps the inbox limit", () => {
		expect(normalizeLimit(undefined)).toBe(20);
		expect(normalizeLimit(0)).toBe(1);
		expect(normalizeLimit(999)).toBe(50);
	});
	test("makes paths repository-relative and rejects escapes", () => {
		expect(normalizePaths("/repo", "/repo/frontend", ["src/a.ts", "./src/a.ts"])).toEqual({
			paths: ["frontend/src/a.ts"],
		});
		expect(normalizePaths("/repo", "/repo", ["../outside"])).toEqual({
			error: 'path "../outside" is outside the repository.',
		});
		expect(normalizePaths("/repo", "/repo", [])).toHaveProperty("error");
	});
});

describe("claims and targets", () => {
	test("a directory claim covers its children in both directions", () => {
		expect(claimsConflict("src", "src/a.ts")).toBe(true);
		expect(claimsConflict("src/api", "src/ui")).toBe(false);
	});
	test("resolves an exact id, a unique label, or a broadcast", () => {
		const sessions = [
			{ id: "s1", label: "frontend" },
			{ id: "s2", label: "backend" },
		];
		expect(resolveRecipients(sessions, "s2", "s1")).toEqual({ recipients: [sessions[1]] });
		expect(resolveRecipients(sessions, "BACKEND", "s1")).toEqual({ recipients: [sessions[1]] });
		expect(resolveRecipients(sessions, "*", "s1")).toEqual({ recipients: [sessions[1]] });
	});
	test("reports an unknown or ambiguous target", () => {
		const sessions = [
			{ id: "s1", label: "same" },
			{ id: "s2", label: "same" },
		];
		expect(resolveRecipients(sessions, "same", "s3")).toHaveProperty("error");
		expect(resolveRecipients(sessions, "missing", "s1")).toHaveProperty("error");
	});
});
