import { describe, expect, test } from "bun:test";
import {
	buildInjection,
	formatCallText,
	formatNotice,
	formatResultText,
	groupDigits,
	injectionPlan,
	MEMORY_CONTEXT_MARKER,
	mutationNotice,
	noteProblemDetail,
	noteProblemText,
} from "./format.ts";
import { notesOf } from "../../test/helpers/fixtures/memory.ts";
import type { MemoryDetails } from "./types.ts";

function details(over: Partial<MemoryDetails> = {}): MemoryDetails {
	return { action: "list", scope: "project", project: [], global: [], changed: false, ...over };
}

describe("injection body", () => {
	test("returns undefined when nothing is stored", () => {
		expect(buildInjection({ project: [], global: [] }, 8192)).toBeUndefined();
	});

	test("lists the project then global sections under the marker", () => {
		const body = buildInjection({ project: notesOf(["p1"]), global: notesOf(["g1"]) }, 8192);
		expect(body?.startsWith(MEMORY_CONTEXT_MARKER)).toBe(true);
		expect(body).toContain("project:\n- p1");
		expect(body).toContain("global:\n- g1");
		expect(body?.indexOf("project:")).toBeLessThan(body?.indexOf("global:") ?? 0);
	});

	test("omits an empty project section, as for an untrusted project", () => {
		const body = buildInjection({ project: [], global: notesOf(["g1"]) }, 8192);
		expect(body).not.toContain("project:");
		expect(body).toContain("global:\n- g1");
	});

	test("caps the body and names the oldest notes it hid", () => {
		const entries = Array.from({ length: 200 }, (_, index) => `note ${index} ${"x".repeat(40)}`);
		const body = buildInjection({ project: [], global: notesOf(entries) }, 512);
		expect(body).toBeDefined();
		expect(Buffer.byteLength(body ?? "", "utf-8")).toBeLessThanOrEqual(512);
		// The tail names the store's oldest notes — the ones a cap always hides first.
		expect(body).toMatch(/- \(\+\d+ more; oldest: "note 0 /);
	});
});

describe("injection plan", () => {
	test("returns undefined when nothing is stored, so the caller can skip the message", () => {
		expect(injectionPlan({ project: [], global: [] }, 8192)).toBeUndefined();
	});

	test("reports no omitted notes when everything fits", () => {
		const plan = injectionPlan({ project: notesOf(["p1"]), global: notesOf(["g1"]) }, 8192);
		expect(plan?.omitted).toEqual({ project: 0, global: 0 });
	});

	test("attributes omissions to the store that overflowed", () => {
		const entries = Array.from({ length: 200 }, (_, index) => `note ${index} ${"x".repeat(40)}`);
		const plan = injectionPlan({ project: notesOf(entries.slice(0, 100)), global: notesOf(entries.slice(100)) }, 512);
		expect(plan?.omitted.project).toBeGreaterThan(0);
		expect(plan?.omitted.global).toBeGreaterThan(0);
		// One tail names the total, not one line per scope, and it names the oldest note.
		const missing = (plan?.omitted.project ?? 0) + (plan?.omitted.global ?? 0);
		expect(plan?.lines.at(-1)).toMatch(new RegExp(`^- \\(\\+${missing} more; oldest: "`));
		expect(plan?.lines.filter((line) => line.startsWith("- (")).length).toBe(1);
	});

	test("keeps the newest notes, counting the oldest as omitted", () => {
		const entries = Array.from({ length: 20 }, (_, index) => `note ${index} ${"x".repeat(60)}`);
		const plan = injectionPlan({ project: notesOf(entries), global: [] }, 600);
		const kept = plan?.lines.filter((line) => line.startsWith("- ") && !line.includes(" more")) ?? [];
		expect(kept.length).toBeGreaterThan(0);
		expect(kept.length).toBeLessThan(entries.length);
		// A note's position is its age, so what survives is a suffix of the store, reversed.
		expect(kept).toEqual(
			[...entries]
				.reverse()
				.slice(0, kept.length)
				.map((entry) => `- ${entry}`),
		);
		expect(plan?.omitted.project).toBe(entries.length - kept.length);
	});

	test("names the oldest note the cap hid, clipped to 28 columns", () => {
		// 28 because the tail reserve is 96 bytes and the scaffolding spends about 40 of them;
		// a wider clip would take the whole reserve for one name.
		const plan = injectionPlan({ project: notesOf(["a".repeat(60), "b".repeat(60)]), global: [] }, 300);
		expect(plan?.omitted.project).toBe(1);
		const tail = plan?.lines.at(-1) ?? "";
		expect(tail).toStartWith('- 1 note not shown: "');
		// The omitted one is the oldest — `a` — and its opening is clipped: the ellipsis is
		// counted inside the 28 columns, so 27 characters and the marker fit the width.
		expect(tail).toContain("a".repeat(27));
		expect(tail).not.toContain("a".repeat(28));
		expect(tail).toContain("— call list");
	});

	test("sanitises a name a person wrote, so the tail stays one line", () => {
		const plan = injectionPlan({ project: notesOf([`he said "no" and left\nthen came back`]), global: [] }, 200);
		const tail = plan?.lines.at(-1) ?? "";
		expect(tail).not.toContain("\n");
		expect(tail).not.toContain('""');
		expect(tail).toContain("he said no and left");
	});

	test("keeps the documented sentence when the cap leaves no room for a name", () => {
		// Below the 96-byte reserve, which is the only way `space` cannot hold a name; the
		// page documents this sentence, so a body still ends in exactly it.
		const plan = injectionPlan({ project: notesOf(["only note"]), global: [] }, 40);
		expect(plan?.lines.at(-1)).toBe("- (+1 more; call list — the store is past the injection cap)");
	});
});

describe("memory text", () => {
	test("formatCallText names the action, scope, and note", () => {
		expect(formatCallText({ action: "add", scope: "global", text: "x" })).toBe("→ add (global): x");
		expect(formatCallText({ action: "update", scope: "global", text: "a", to: "b" })).toBe("→ update (global): a → b");
		expect(formatCallText({ action: "list" })).toBe("→ list");
		expect(formatCallText({ action: "merge", scope: "project", first: "a", second: "b", merged: "ab" })).toBe(
			"→ merge (project): a + b → ab",
		);
		expect(formatCallText({ action: "merge", first: "a" })).toBe("→ merge (project): a");
		expect(formatCallText({ action: "merge" })).toBe("→ merge (project)");
	});

	test("formatCallText leaves out a note that has not arrived yet", () => {
		expect(formatCallText({}, false)).toBe("→ …");
		expect(formatCallText({ action: "add" }, false)).toBe("→ add (project)");
		expect(formatCallText({ action: "add" })).toBe("→ add (project)");
		expect(formatCallText({ action: "update", text: "a" })).toBe("→ update (project): a");
		expect(formatCallText({})).toBe("");
	});

	test("formatResultText confirms a write without repeating the note", () => {
		const added = formatResultText(details({ action: "add", changed: true, entry: "x", project: ["x"] }));
		// The confirmation is one line: the counts are a stat nobody acts on.
		expect(added).toBe("Added to project memory");
		expect(formatResultText(details({ action: "add", changed: false, entry: "x" }))).toContain(
			"Already in project memory",
		);
		expect(formatResultText(details({ action: "add", changed: false, entry: "use tabs", existing: "Use tabs" }))).toBe(
			"Already in project memory (near-duplicate): Use tabs",
		);
		expect(formatResultText(details({ action: "add", changed: false, entry: "x", existing: "x" }))).toBe(
			"Already in project memory: x",
		);
		expect(
			formatResultText(details({ action: "merge", changed: true, entry: "a", second: "b", project: ["ab"] })),
		).toBe("Merged 2 project notes\nNow 1 project, 0 global.");
		expect(formatResultText(details({ action: "forget", changed: true, entry: "x" }))).toBe(
			"Removed from project memory\nNow 0 project, 0 global.",
		);
	});

	test("formatResultText reports update and a no-op update", () => {
		expect(formatResultText(details({ action: "update", changed: true, entry: "a", to: "b", project: ["b"] }))).toBe(
			"Updated project memory\nNow 1 project, 0 global.",
		);
		expect(formatResultText(details({ action: "update", changed: false, entry: "a", to: "a" }))).toContain(
			"Already set in project memory: a",
		);
	});

	test("formatResultText lists both scopes", () => {
		const text = formatResultText(details({ action: "list", project: ["p"], global: ["g"] }));
		expect(text).toContain("project (1):");
		expect(text).toContain("global (1):");
	});

	test("formatResultText caps a collapsed list and expands all of it", () => {
		const many = Array.from({ length: 14 }, (_, index) => `note ${index}`);
		const collapsed = formatResultText(details({ action: "list", project: many }));
		expect(collapsed).toContain("- (+2 more)");
		const expanded = formatResultText(details({ action: "list", project: many }), true);
		expect(expanded).not.toContain("more)");
		expect(expanded).toContain("- note 13");
	});

	test("formatResultText surfaces an error", () => {
		expect(formatResultText(details({ error: "boom" }))).toBe("Error: boom");
	});

	test("formatNotice reports an empty store", () => {
		expect(formatNotice({ project: [], global: [] })).toBe("No durable memory stored yet.");
	});

	test("mutationNotice reports what the store did, not what the screen tried", () => {
		expect(mutationNotice("merge", true, "project")).toBe("Merged 2 project notes.");
		expect(mutationNotice("merge", false, "project")).toBe("Those notes are no longer both here.");
		expect(mutationNotice("update", true, "global")).toBe("Updated global note.");
		expect(mutationNotice("update", false, "global")).toBe("That note is no longer here.");
		expect(mutationNotice("forget", true, "project")).toBe("Forgot project note.");
		expect(mutationNotice("forget", false, "project")).toBe("That note was already gone.");
	});

	test("formatNotice lists both stores", () => {
		expect(formatNotice({ project: notesOf(["p"]), global: notesOf(["g"]) })).toBe(
			"Memory:\nproject (1):\n- p\nglobal (1):\n- g",
		);
	});
});

describe("over-cap notes", () => {
	const problem = { line: 12, length: 1539, note: { text: "x".repeat(1539) } };

	test("groups a count the way the evidence wrote it", () => {
		expect(groupDigits(1539)).toBe("1,539");
		expect(groupDigits(500)).toBe("500");
		expect(groupDigits(262144)).toBe("262,144");
	});

	test("names the store, the line, the length and the cap in one warning sentence", () => {
		expect(noteProblemText("project", problem, 500)).toBe(
			"project line 12 is 1,539 characters; the limit is 500 — /memory edit or /memory forget",
		);
	});

	test("gives the doctor a line with the note's opening words", () => {
		const long = noteProblemDetail(problem);
		expect(long).toStartWith('line 12 · 1,539 characters · "');
		// `clip` marks what it shortened, so the length of the quote is the kit's, not a literal's.
		expect(long).toContain("…");
		expect(noteProblemDetail({ line: 3, length: 501, note: { text: "tiny hook" } })).toBe(
			'line 3 · 501 characters · "tiny hook"',
		);
	});
});
