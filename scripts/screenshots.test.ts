/**
 * Docs screenshots and the render plumbing behind them.
 *
 * Covers the capturable frames, the two shot CLIs' argument contract, the tool
 * gallery's fixtures and renderings, and the ANSI-to-HTML bridge the headless
 * Chrome capture uses. Width and title gates matter here: a renamed field or a
 * changed constructor still produces a PNG, just one that no longer matches the
 * product.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { ansiLinesToHtml, ansiToHtml, cssFor, parseAnsi } from "./ansi-html.ts";
import { parseArgs as parseBoardArgs } from "./shots/board.ts";
import { parseArgs as parseFileBrowseArgs } from "./shots/file-browse.ts";
import { parseArgs as parseFlowArgs } from "./shots/plan-flow.ts";
import { parseArgs as parsePlanReviewArgs } from "./shots/plan-review.ts";
import { draftSeed } from "./shots/plan-review-capture.ts";
import { stripFeedback } from "../extensions/plan/feedback.ts";
import { planDigest } from "../extensions/plan/plan-text.ts";
import { SCREENS } from "./screens/index.ts";
import { HERO_GOAL, HERO_TODOS } from "./screens/fixtures/index.ts";
import { GoalWidget } from "../extensions/goal/tui.ts";
import { TodoWidget } from "../extensions/todo/tui.ts";
import { pageColors, readPageColors, repo, setThemeInstance, theme } from "./theme.ts";
import { FIXTURES } from "./tools/fixtures/index.ts";
import { galleryHtml, registeredToolNames, renderingFor, renderings } from "./tools/index.ts";

/** Every capturable frame, the whole-chrome preview included. */
const FRAMES = SCREENS;

/** Widths a capture has to survive: a narrow terminal, the default, a wide one. */
const WIDTHS = [46, 80, 120];

describe("docs screenshots", () => {
	test("asset stems and window titles are unique", () => {
		const frames = Object.entries(FRAMES);
		expect(new Set(frames.map(([, screen]) => screen.asset)).size).toBe(frames.length);
		// The capture finds its window by a title substring, so two screens sharing
		// one would race for the wrong window.
		expect(new Set(frames.map(([, screen]) => screen.title)).size).toBe(frames.length);
		for (const [name, screen] of frames) expect(screen.title.trim(), name).not.toBe("");
	});

	test("every frame renders non-empty and inside the width", () => {
		for (const [name, screen] of Object.entries(FRAMES)) {
			for (const width of WIDTHS) {
				const lines = screen.render(width, 30);
				expect(lines.length, `${name} @ ${width}`).toBeGreaterThan(0);
				const overflow = lines.filter((line) => visibleWidth(line) > width);
				expect(overflow, `${name} @ ${width}`).toEqual([]);
			}
		}
	});

	test("a sized frame is no taller than its window rows", () => {
		// A frame longer than the window scrolls the terminal, which silently clips
		// the header line out of the capture.
		for (const [name, screen] of Object.entries(FRAMES)) {
			if (!screen.size) continue;
			const lines = screen.render(screen.size.width, screen.size.rows);
			expect(lines.length, `${name} (${screen.size.width}x${screen.size.rows})`).toBeLessThanOrEqual(screen.size.rows);
		}
	});

	test("the hero's rails are one line each, inside the width", () => {
		// The rails are the window's bottom: a wrapped rail would push the footer off
		// the frame, so both stay one clipped line at every width the gate renders.
		setThemeInstance(theme);
		for (const width of WIDTHS) {
			for (const rail of [new GoalWidget(HERO_GOAL, theme), new TodoWidget(HERO_TODOS, theme)]) {
				const lines = rail.render(width);
				expect(lines.length, `${width}`).toBe(1);
				expect(visibleWidth(lines[0] ?? ""), `${width}`).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("board shot arguments", () => {
	test("defaults to the two tabs in assets/screens, with no dialog", () => {
		const options = parseBoardArgs([]);
		expect(basename(options.outDir)).toBe("screens");
		expect(options.outDir).toContain("assets");
		expect(options.width).toBe(1280);
		expect(options.scale).toBe(1);
		expect(options.theme).toBeUndefined();
		expect(options.waitMs).toBe(8000);
		expect(options.dialog).toBeUndefined();
	});

	test("flags override the defaults", () => {
		const options = parseBoardArgs([
			"--out",
			"shots",
			"--width",
			"900",
			"--scale",
			"2",
			"--theme",
			"dark",
			"--wait",
			"50",
		]);
		expect(options.outDir).toBe(resolve("shots"));
		expect(options.width).toBe(900);
		expect(options.scale).toBe(2);
		expect(options.theme).toBe("dark");
		expect(options.waitMs).toBe(50);
	});

	test("takes one dialog, and refuses another", () => {
		for (const dialog of ["card", "confirm", "new", "edit"] as const) {
			expect(parseBoardArgs(["--dialog", dialog]).dialog).toBe(dialog);
		}
		expect(() => parseBoardArgs(["--dialog", "menu"])).toThrow("--dialog must be card, confirm, new, or edit");
	});

	test("refuses an option it does not have, and a positional", () => {
		expect(() => parseBoardArgs(["--root", "docs"])).toThrow("unknown option --root");
		expect(() => parseBoardArgs(["extra"])).toThrow("unexpected argument extra");
	});

	test("takes --viewer, so the read-only page is reviewed as a picture", () => {
		// A viewer's page is the same document with one attribute changed; the flag is how
		// that state is captured without a second session serving it.
		expect(parseBoardArgs(["--viewer"]).viewer).toBe(true);
		expect(parseBoardArgs([]).viewer).toBeUndefined();
	});
});

describe("file-browse shot arguments", () => {
	test("defaults to the fixture root, README.md, and file-browse.png", () => {
		const options = parseFileBrowseArgs([]);
		expect(options.root).toBeUndefined();
		expect(options.file).toBe("README.md");
		expect(basename(options.out)).toBe("file-browse.png");
		expect(options.width).toBe(1280);
		expect(options.scale).toBe(1);
		expect(options.theme).toBeUndefined();
		expect(options.waitMs).toBe(8000);
	});

	test("flags override the defaults", () => {
		const options = parseFileBrowseArgs([
			"--root",
			"docs",
			"--file",
			"guide.md",
			"-o",
			"shot.png",
			"--width",
			"900",
			"--scale",
			"2",
			"--theme",
			"light",
			"--wait",
			"100",
		]);
		expect(options.root).toBe(resolve("docs"));
		expect(options.file).toBe("guide.md");
		expect(basename(options.out)).toBe("shot.png");
		expect(options.width).toBe(900);
		expect(options.scale).toBe(2);
		expect(options.theme).toBe("light");
		expect(options.waitMs).toBe(100);
	});

	test("rejects a file outside the served root and unusable flags", () => {
		const invalid: ReadonlyArray<readonly [argv: string[], message: string]> = [
			[["--file", "/etc/passwd"], "--file must be root-relative"],
			[["--theme", "sepia"], "--theme must be light or dark"],
			[["--width", "10"], "--width must be at least 320"],
			[["--scale", "0"], "--scale must be positive"],
			[["--wait", "-1"], "--wait must not be negative"],
			[["--root"], "--root needs a value"],
			[["--nope"], "unknown option --nope"],
			[["extra"], "unexpected argument extra"],
		];
		for (const [argv, message] of invalid) {
			expect(() => parseFileBrowseArgs(argv), argv.join(" ")).toThrow(message);
		}
	});
});

describe("plan flow shot arguments", () => {
	test("captures every card at 2x by default", () => {
		const options = parseFlowArgs([]);
		expect(options.cards).toEqual(["flow", "graphic"]);
		expect(options.out).toBe("");
		expect(options.scale).toBe(2);
		expect(options.waitMs).toBe(8000);
	});

	test("naming a card captures only it, and the flags override the defaults", () => {
		const options = parseFlowArgs(["graphic", "-o", "shot.png", "--scale", "1", "--wait", "100"]);
		expect(options.cards).toEqual(["graphic"]);
		expect(basename(options.out)).toBe("shot.png");
		expect(options.scale).toBe(1);
		expect(options.waitMs).toBe(100);
	});

	test("rejects a fixed width, an unknown card, and one output for two cards", () => {
		const invalid: ReadonlyArray<readonly [argv: string[], message: string]> = [
			[["--width", "900"], "--width is fixed: a card is a 1200×675 box"],
			[["poster"], 'unknown card "poster"; expected flow or graphic'],
			// Only the default set can hold more than one card: a second positional is
			// already an error, so `-o` with no card named is the reachable mistake.
			[["-o", "shot.png"], "-o names one file; capture one card at a time"],
			[["flow", "graphic"], "unexpected argument graphic"],
			[["--theme", "sepia"], "--theme must be light or dark"],
			[["--nope"], "unknown option --nope"],
		];
		for (const [argv, message] of invalid) {
			expect(() => parseFlowArgs(argv), argv.join(" ")).toThrow(message);
		}
	});
});

describe("plan review shot arguments", () => {
	test("a plan path defaults the output to its stem", () => {
		const options = parsePlanReviewArgs(["docs/some-plan.md"]);
		expect(basename(options.plan)).toBe("some-plan.md");
		expect(basename(options.out)).toBe("some-plan.png");
		expect(options.width).toBe(1280);
		expect(options.scale).toBe(2);
		expect(options.theme).toBeUndefined();
		expect(options.waitMs).toBe(8000);
	});

	test("flags override the defaults", () => {
		const options = parsePlanReviewArgs([
			"plan.md",
			"-o",
			"shot.png",
			"--width",
			"900",
			"--scale",
			"1",
			"--theme",
			"dark",
			"--wait",
			"100",
		]);
		expect(basename(options.out)).toBe("shot.png");
		expect(options.width).toBe(900);
		expect(options.scale).toBe(1);
		expect(options.theme).toBe("dark");
		expect(options.waitMs).toBe(100);
	});

	test("--as captures the reviewer's page", () => {
		expect(parsePlanReviewArgs(["plan.md"]).role).toBe("owner");
		expect(parsePlanReviewArgs(["plan.md", "--as", "reviewer"]).role).toBe("reviewer");
	});

	test("--post binds a reviewer link before the capture", () => {
		// The frame shows the state after a teammate's first post, which is what binds
		// her name to the link.
		expect(parsePlanReviewArgs(["plan.md", "--as", "reviewer", "--post", "alice"]).post).toBe("alice");
		expect(parsePlanReviewArgs(["plan.md"]).post).toBeUndefined();
	});

	test("--share captures the owner's dialog, where a name may also be bound", () => {
		// The dialog is the owner's own surface, and binding one of its links needs a
		// post through that link rather than through the page being captured.
		expect(parsePlanReviewArgs(["plan.md"]).share).toBeUndefined();
		expect(parsePlanReviewArgs(["plan.md", "--share"]).share).toBe(true);
		expect(parsePlanReviewArgs(["plan.md", "--share", "--post", "alice"]).post).toBe("alice");
	});

	test("--draft starts the tab with an unsaved comment", () => {
		expect(parsePlanReviewArgs(["plan.md", "--draft", "tighten this"]).draft).toBe("tighten this");
		expect(parsePlanReviewArgs(["plan.md"]).draft).toBeUndefined();
	});

	test("a draft seed writes the record the client itself would have", () => {
		// A seed is only faithful if the client would have written the same thing: the
		// same storage key, the plan's own revision, and the first block as the anchor.
		const content = "# Plan\n\nBody\n";
		const written: Record<string, string> = {};
		const fakeWindow = { sessionStorage: { setItem: (key: string, value: string) => void (written[key] = value) } };
		new Function("window", draftSeed(content, "tighten this step"))(fakeWindow);

		expect(JSON.parse(written["bf-review-draft"] ?? "null")).toEqual({
			rev: planDigest(stripFeedback(content)),
			mine: [{ anchor: 0, comment: "tighten this step" }],
		});
	});

	test("rejects a missing plan, an unknown flag, and bad values", () => {
		const invalid: ReadonlyArray<readonly [argv: string[], message: string]> = [
			[[], "a plan path is required"],
			[["plan.md", "--nope"], "unknown option"],
			[["plan.md", "--theme", "sepia"], "--theme must be light or dark"],
			[["plan.md", "--width", "10"], "--width must be at least 320"],
			[["plan.md", "--scale", "0"], "--scale must be positive"],
			[["plan.md", "--wait", "-1"], "--wait must not be negative"],
			[["plan.md", "--width"], "--width needs a value"],
			[["plan.md", "--as", "admin"], "--as must be owner or reviewer"],
			[["plan.md", "--post", "alice"], "--post needs --as reviewer or --share"],
			[["plan.md", "--as", "reviewer", "--share"], "--share captures the owner's Share dialog"],
			[["plan.md", "--as", "reviewer", "--post", "  "], "--post needs a reviewer name"],
			[["plan.md", "--draft", "  "], "--draft needs the comment text"],
			[["plan.md", "--as", "reviewer", "--post", "alice", "--draft", "x"], "--draft cannot be combined with --post"],
		];
		for (const [argv, message] of invalid) {
			expect(() => parsePlanReviewArgs(argv), argv.join(" ")).toThrow(message);
		}
	});
});

describe("tool fixtures", () => {
	test("every fixture is unique and named", () => {
		const names = FIXTURES.map((fixture) => fixture.name);
		expect(new Set(names).size).toBe(names.length);
		for (const fixture of FIXTURES) {
			expect(fixture.name.length, fixture.name).toBeGreaterThan(0);
			expect(fixture.label.length, fixture.name).toBeGreaterThan(0);
		}
	});

	test("every tool the package registers has a fixture", () => {
		const covered = new Set(FIXTURES.filter((fixture) => fixture.group === "package").map((fixture) => fixture.name));
		const missing = registeredToolNames().filter((name) => !covered.has(name));
		expect(missing).toEqual([]);
	});

	test("no fixture names the real workspace or home", () => {
		const json = JSON.stringify(FIXTURES);
		expect(json).not.toContain("my-pi-agent");
		expect(json).not.toContain(homedir());
	});

	test("a fixture never references itself through an absolute real path", () => {
		for (const fixture of FIXTURES) {
			const args = JSON.stringify(fixture.args ?? {});
			expect(args.startsWith("/Users/"), fixture.name).toBe(false);
		}
	});
});

describe("tool renderings", () => {
	test("every rendering renders something at the gallery width", () => {
		for (const rendering of renderings()) {
			expect(rendering.lines(80).length, rendering.name).toBeGreaterThan(0);
		}
	});

	test("every line fits the width it was given", () => {
		for (const rendering of renderings()) {
			for (const width of WIDTHS) {
				for (const line of rendering.lines(width)) {
					expect(visibleWidth(line), `${rendering.name} @ ${width}`).toBeLessThanOrEqual(width);
				}
			}
		}
	});

	test("a tool block leads with its call and rails the result", () => {
		const read = renderings().find((rendering) => rendering.name === "read");
		const lines = (read?.lines(80) ?? []).map(stripTerminalSequences);
		expect(lines[0]?.startsWith("read ")).toBe(true);
		expect(lines[1]?.startsWith("╎ ")).toBe(true);
		expect(lines[1]?.startsWith("╎  ")).toBe(false);

		// A multi-line call keeps its two-space continuation, with no rail.
		const subagent = renderings().find((rendering) => rendering.name === "subagent");
		const call = (subagent?.lines(80) ?? []).map(stripTerminalSequences);
		expect(call[1]?.startsWith("  1. ")).toBe(true);

		// The file-mutating tools carry their result on the call body: that body is
		// railed, and there is no status band behind it.
		for (const name of ["edit", "write"]) {
			const rendering = renderings().find((item) => item.name === name);
			const raw = (rendering?.lines(80) ?? []).join("\n");
			expect(raw, name).not.toContain("\u001b[48;");
			const body = (rendering?.lines(80) ?? []).map(stripTerminalSequences);
			expect(body[1]?.startsWith("╎ "), name).toBe(true);
		}
	});

	test("the capture keeps the decorations a terminal draws", () => {
		// The gallery is built from ANSI in a process without a TTY, so the capture
		// decorates the theme itself; otherwise a name loses its bold and the diff's
		// changed words lose their reverse video.
		const edit = renderings().find((rendering) => rendering.name === "edit");
		const raw = (edit?.lines(80) ?? []).join("\n");
		expect(raw).toContain("\u001b[1medit");
		expect(raw).toContain("\u001b[7m");
		expect(raw).toContain("\u001b[27m");
	});

	test("one fixture builds alone, for a caller drawing a single block", () => {
		// The hero draws the gallery's `edit` block without constructing the other
		// thirty renderings, so the lookup has to return the same block.
		const edit = renderingFor("edit");
		const lines = (edit?.lines(60) ?? []).map(stripTerminalSequences);
		expect(lines[0]?.startsWith("edit ")).toBe(true);
		expect(lines[1]?.startsWith("╎ ")).toBe(true);
		expect(renderingFor("nope")).toBeUndefined();
	});

	test("the gallery page includes every rendering in its group", () => {
		const all = renderings();
		const html = galleryHtml(80);
		expect(html.match(/<figure class="block">/g)).toHaveLength(all.length);
		for (const rendering of all) expect(html, rendering.name).toContain(rendering.name);
		for (const heading of ["Transcript", "Pi built-ins", "Package tools"]) expect(html).toContain(heading);
	});
});

describe("ANSI to HTML", () => {
	test("escapes markup and leaves plain text alone", () => {
		expect(ansiToHtml("<b> & </b>")).toBe("&lt;b&gt; &amp; &lt;/b&gt;");
	});

	test("converts truecolor foreground and background", () => {
		const cases: ReadonlyArray<readonly [input: string, html: string]> = [
			["\u001b[38;2;88;166;255mhi\u001b[39m", '<span style="color:#58a6ff">hi</span>'],
			["\u001b[48;2;1;2;3mx", '<span style="background-color:#010203">x</span>'],
		];
		for (const [input, html] of cases) expect(ansiToHtml(input)).toBe(html);
	});

	test("maps the basic colours and the 256-colour palette", () => {
		const cases: ReadonlyArray<readonly [input: string, html: string]> = [
			["\u001b[31mx\u001b[39m", '<span style="color:#cd0000">x</span>'],
			["\u001b[42mx\u001b[49m", '<span style="background-color:#00cd00">x</span>'],
			["\u001b[91mx\u001b[39m", '<span style="color:#ff0000">x</span>'],
			["\u001b[103mx\u001b[49m", '<span style="background-color:#ffff00">x</span>'],
			["\u001b[38;5;196mx", '<span style="color:#ff0000">x</span>'],
			["\u001b[38;5;232mx", '<span style="color:#080808">x</span>'],
		];
		for (const [input, html] of cases) expect(ansiToHtml(input)).toBe(html);
	});

	test("handles bold, dim, italic, underline, and strike", () => {
		expect(ansiToHtml("\u001b[1mB\u001b[22m")).toBe('<span style="font-weight:600">B</span>');
		expect(ansiToHtml("\u001b[2m\u001b[3mx")).toBe('<span style="opacity:.6;font-style:italic">x</span>');
		expect(ansiToHtml("\u001b[4m\u001b[9mx")).toBe('<span style="text-decoration:underline line-through">x</span>');
	});

	test("a reset clears everything after it", () => {
		expect(ansiToHtml("\u001b[1mA\u001b[0mB")).toBe('<span style="font-weight:600">A</span>B');
	});

	test("drops an OSC sequence and a non-SGR CSI", () => {
		expect(ansiToHtml("\u001b]0;a title\u0007hi")).toBe("hi");
		expect(ansiToHtml("a\u001b[2Kb")).toBe("ab");
	});

	test("draws reverse video as a swapped background", () => {
		expect(ansiToHtml("\u001b[38;2;63;185;80m+a \u001b[7mb\u001b[27m c")).toBe(
			'<span style="color:#3fb950">+a </span><span style="color:#0d1117;background-color:#3fb950">b</span><span style="color:#3fb950"> c</span>',
		);
	});
});

describe("parseAnsi", () => {
	test("splits runs and carries the style in effect", () => {
		expect(parseAnsi("a\u001b[31mb\u001b[39mc")).toEqual([
			{ text: "a", style: {} },
			{ text: "b", style: { fg: "#cd0000" } },
			{ text: "c", style: {} },
		]);
	});

	test("drops empty runs around adjacent sequences", () => {
		expect(parseAnsi("\u001b[1m\u001b[2mx")).toEqual([{ text: "x", style: { bold: true, dim: true } }]);
	});

	test("leaves plain text as one run", () => {
		expect(parseAnsi("plain")).toEqual([{ text: "plain", style: {} }]);
	});
});

describe("page palette", () => {
	test("resolves the shipped theme's own page and text colours", () => {
		// Read the JSON raw, not through the resolver: the two exports are a chain of
		// maps, and a hardcoded role would pass a comparison against itself.
		const document = JSON.parse(readFileSync(join(repo, "themes", "bytefly-dark.json"), "utf-8")) as {
			vars: Record<string, string>;
			export: Record<string, string>;
		};
		expect(pageColors).toEqual({
			background: document.vars[document.export.pageBg],
			text: document.vars.text,
		});
	});

	test("fails loudly when a colour role does not resolve", () => {
		const file = join(mkdtempSync(join(tmpdir(), "pi-page-colors-")), "dangling.json");
		writeFileSync(
			file,
			JSON.stringify({ vars: { text: "#ffffff" }, colors: { text: "text" }, export: { pageBg: "canvas" } }),
		);
		expect(() => readPageColors(file)).toThrow('export.pageBg names "canvas"');
	});
});

describe("cssFor", () => {
	test("is empty for an unstyled run", () => {
		expect(cssFor({})).toBe("");
	});

	test("inverse swaps the cell's colours against the page", () => {
		expect(cssFor({ inverse: true })).toBe(`color:${pageColors.background};background-color:${pageColors.text}`);
		expect(cssFor({ inverse: true, fg: "#f85149" })).toBe(`color:${pageColors.background};background-color:#f85149`);
		expect(cssFor({ inverse: true, bg: "#cd0000", fg: "#58a6ff" })).toBe("color:#cd0000;background-color:#58a6ff");
	});
});

describe("ansiLinesToHtml", () => {
	test("joins lines with a newline", () => {
		expect(ansiLinesToHtml(["a", "\u001b[31mb"])).toBe('a\n<span style="color:#cd0000">b</span>');
	});
});
