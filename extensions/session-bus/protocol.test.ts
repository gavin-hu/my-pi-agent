import { describe, expect, test } from "bun:test";
import {
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
	test("hands a path that resolves to the root on in the caller's own spelling", () => {
		// The refusal is `resolve.ts`'s, so this module does not pre-empt it with a worse one.
		expect(normalizePaths("/repo", "/repo", ["."])).toEqual({ paths: ["."] });
		expect(normalizePaths("/repo", "/repo", ["src/.."])).toEqual({ paths: ["src/.."] });
		// From below the root, the same spelling is an ordinary claim on that directory.
		expect(normalizePaths("/repo", "/repo/src", ["."])).toEqual({ paths: ["src"] });
	});
});

describe("claim targets", () => {
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
