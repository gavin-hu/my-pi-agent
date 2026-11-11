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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { ansiLinesToHtml, ansiToHtml, cssFor, parseAnsi } from "./ansi-html.ts";
import { parseArgs as parseBoardArgs } from "./shots/board.ts";
import { parseArgs as parseFileBrowseArgs } from "./shots/file-browse.ts";
import { parseArgs as parseCardArgs } from "./shots/cards.ts";
import { frameFingerprint, frameLines, readFrames } from "./screens/frames.ts";
import { SCREENS } from "./screens/index.ts";
import { CHROME_SNAPSHOT, HERO_CALLS, HERO_INPUT, HERO_TOKENS } from "./screens/whole-window.ts";
import { cacheHitRateOf } from "../extensions/bytefly/footer/collect/entries.ts";
import { CURRENCY_DEFAULTS, DEFAULT_RATES_USD } from "../extensions/bytefly/footer/price/config.ts";
import { createPricer } from "../extensions/bytefly/footer/price/price.ts";
import { TRANSCRIPT_NOTICE } from "./transcript-fixture.ts";
import { FIXTURE_CARDS } from "./tools/fixtures/board-store.ts";
import { fixturePlanDir, fixturePlanPath } from "./tools/fixtures/board.ts";
import { JOB_RECORDS } from "./tools/fixtures/index.ts";
import { HERO_GOAL, HERO_TODOS } from "./screens/fixtures/index.ts";
import { GoalWidget } from "../extensions/goal/tui.ts";
import { TodoWidget } from "../extensions/todo/widget.ts";
import { pageColors, readPageColors, repo, setThemeInstance, theme } from "./theme.ts";
import { FIXTURES } from "./tools/fixtures/index.ts";
import { galleryHtml, registeredToolNames, renderingFor, renderings } from "./tools/index.ts";
import { planForContract } from "../lib/board/artifact.ts";
import { isInside } from "../lib/path.ts";
import { resolvePlanArg } from "../lib/plans/paths.ts";
import { GLYPHS, SEPARATORS } from "../lib/tui/glyphs.ts";

/** Every capturable frame, the whole-chrome preview included. */
const FRAMES = SCREENS;

/** The one platform the pictures are taken on: Terminal.app and `screencapture` are macOS. */
const CAPTURE_PLATFORM = "darwin";

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

	// A picture of a macOS window: captured there, so only that platform can draw the
	// same frame. The header spells the option key the way the OS does (`option+enter`
	// on macOS, `alt+enter` elsewhere), which re-packs its help rows, and a fixture path
	// is printed with the native separator (`\home\u\…` on Windows). The claims that
	// hold everywhere — a frame fits its width and its rows — are the two tests above.
	test.skipIf(process.platform !== CAPTURE_PLATFORM)("a captured frame is still the frame the renderer draws", () => {
		// The picture cannot report on itself: two captures of one frame differ by
		// antialiasing, so no render is byte-identical to the shipped PNG. What the
		// capture records instead is the frame that was on screen, and this is where
		// a renderer change nobody recaptured fails.
		const recorded = readFrames();
		// The hero is embedded in the root README, so it is the frame that must not
		// quietly lose its guard.
		expect(Object.keys(recorded)).toContain("chrome");
		for (const [name, fingerprint] of Object.entries(recorded)) {
			const screen = FRAMES[name];
			if (!screen?.size) {
				expect(screen && name, `${name} is recorded but pins no size, or is no longer a screen`).toBeUndefined();
				continue;
			}
			const { width, rows } = screen.size;
			const lines = frameLines(screen, width, rows);
			const frame = frameFingerprint(lines);
			// A hash says only that something moved, which is no help to whoever reads a
			// red job; the frame it just drew is what they need, and it is already here.
			if (frame !== fingerprint) {
				for (const [index, line] of lines.entries()) console.log(`${name}|${index}|${JSON.stringify(line)}`);
			}
			expect(frame, `assets/screens/${screen.asset}.png is behind the frame: bun run capture:screens ${name}`).toBe(
				fingerprint,
			);
		}
	});

	test("the hero is true of a real session", () => {
		// Every claim in the frame is re-derived here from the frame's own content or the
		// shipped tables: a picture whose footer is about cost cannot print a cost the code
		// would not, and a window cannot omit the slot a session types into.
		const size = SCREENS.chrome?.size ?? { width: 0, rows: 0 };
		expect(size).toEqual({ width: 100, rows: 36 });
		const lines = SCREENS.chrome?.render(size.width, size.rows) ?? [];
		// The frame fills the window it is captured in: a shorter one leaves its spare
		// cells at the bottom of the picture, where nothing accounts for them.
		expect(lines.length).toBe(size.rows);

		// Three blank rows sit above the Goal rail, and the row above them is the turn rule:
		// the gap is where a short transcript leaves the window's spare rows.
		const goal = lines.findIndex((line) => stripTerminalSequences(line).startsWith("Goal ·"));
		expect(goal).toBeGreaterThan(3);
		for (const row of [1, 2, 3]) {
			expect(stripTerminalSequences(lines[goal - row] ?? "x").trim(), `row ${row} above Goal`).toBe("");
		}
		expect(stripTerminalSequences(lines[goal - 4] ?? "")).toContain("turn 3");

		// The composer is between the rails and the footer, with no live-cursor markers left
		// in a still.
		const input = lines.findIndex((line) => stripTerminalSequences(line).trim() === HERO_INPUT);
		expect(input).toBeGreaterThan(0);
		expect(stripTerminalSequences(lines[input + 1] ?? "").trim()).toMatch(/^─+$/);
		expect(stripTerminalSequences(lines[input - 1] ?? "").trim()).toMatch(/^─+$/);
		expect(lines.join("\n")).not.toContain("_pi:");

		// The money follows from the tokens and the shipped USD table, at the precision the
		// currency's own default supplies.
		const priced = createPricer({
			currency: CURRENCY_DEFAULTS.USD,
			rates: DEFAULT_RATES_USD,
			peak: { timezone: "Asia/Shanghai", windows: [] },
			budget: 0,
		})([
			{
				provider: "deepseek",
				model: "deepseek-flash",
				...HERO_TOKENS,
				recordedCost: 0,
				at: null,
				isAssistant: true,
			},
		]);
		expect(CHROME_SNAPSHOT.usage.cost).toBe(priced.cost);
		expect(CHROME_SNAPSHOT.usage.cost).toBeGreaterThan(0);
		expect(CHROME_SNAPSHOT.currency).toEqual(CURRENCY_DEFAULTS.USD);
		expect(CHROME_SNAPSHOT.currency.decimals).toBe(3);
		expect(CHROME_SNAPSHOT.cacheHitRate).toBeCloseTo(
			cacheHitRateOf(HERO_TOKENS.input, HERO_TOKENS.cacheRead, HERO_TOKENS.cacheWrite) ?? 0,
			6,
		);

		// The notice names the jobs the gallery's table names, and the rule counts the calls
		// the frame actually draws.
		expect((TRANSCRIPT_NOTICE.items ?? []).map((item) => item.label)).toEqual(
			JOB_RECORDS.map((job) => `${job.id} ${job.label}`),
		);
		expect((TRANSCRIPT_NOTICE.items ?? []).map((item) => item.detail)).toEqual(
			JOB_RECORDS.map((job) => `exit ${job.exitCode ?? 0}`),
		);
		for (const call of HERO_CALLS) expect(renderingFor(call), call).toBeDefined();
		const rule = lines.find((line) => stripTerminalSequences(line).includes("turn 3"));
		expect(rule).toContain(` ${HERO_CALLS.length} tool${HERO_CALLS.length === 1 ? "" : "s"} `);

		// Nothing in the frame claims a version: the header prints the package's current one,
		// so a rail naming a version could contradict it.
		for (const rail of [HERO_GOAL, HERO_TODOS]) {
			expect(JSON.stringify(rail)).not.toMatch(/\bv?\d+\.\d+\.\d+/);
		}
	});

	test("the mode chip reads in the warning role and names only the mode", () => {
		// The bar draws the mode's own word in the planning role, so the frame carries the
		// theme's warning colour and neither the plan file name nor a truncation ellipsis.
		const size = SCREENS.chrome?.size ?? { width: 0, rows: 0 };
		const lines = frameLines(SCREENS.chrome, size.width, size.rows);
		const footer = lines.find((line) => stripTerminalSequences(line).startsWith(`${GLYPHS.plan} plan`));
		expect(footer).toBeDefined();

		const document = JSON.parse(readFileSync(join(repo, "themes", "bytefly-dark.json"), "utf8")) as {
			vars: Record<string, string>;
			colors: Record<string, string>;
		};
		const warning = document.vars[document.colors.warning ?? ""] ?? "";
		const rgb = [1, 3, 5].map((at) => Number.parseInt(warning.slice(at, at + 2), 16)).join(";");
		expect(footer?.startsWith(`\u001b[38;2;${rgb}m`)).toBe(true);
		expect(stripTerminalSequences(footer ?? "").startsWith(`${GLYPHS.plan} plan${SEPARATORS.item.trimEnd()}`)).toBe(
			true,
		);
	});

	test("every colour a screen draws comes from the shipped palette", () => {
		// A frame is the documentation for the theme, so a colour outside `themes/bytefly-dark.json`
		// is either a hardcoded hex or a token that left the palette — both invisible in a review.
		const document = JSON.parse(readFileSync(join(repo, "themes", "bytefly-dark.json"), "utf8")) as {
			vars: Record<string, string>;
		};
		const palette = new Set(Object.values(document.vars).map((hex) => hex.toLowerCase()));
		expect(palette.size).toBeGreaterThan(5);

		for (const [name, screen] of Object.entries(FRAMES)) {
			const size = screen.size ?? { width: 100, rows: 30 };
			const drawn = new Set(
				[
					...frameLines(screen, size.width, size.rows)
						.join("\n")
						.matchAll(/\u001b\[38;2;(\d+;\d+;\d+)m/g),
				].map((match) => match[1]),
			);
			for (const rgb of drawn) {
				const hex = `#${(rgb ?? "")
					.split(";")
					.map((part) => Number(part).toString(16).padStart(2, "0"))
					.join("")}`;
				expect(palette.has(hex), `${name}: ${rgb} is not a colour in themes/bytefly-dark.json`).toBe(true);
			}
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

	test("takes the card dialog, and refuses any other — a reader cannot open a composer", () => {
		expect(parseBoardArgs(["--dialog", "card"]).dialog).toBe("card");
		for (const dialog of ["confirm", "new", "edit", "menu"]) {
			expect(() => parseBoardArgs(["--dialog", dialog])).toThrow("--dialog must be card");
		}
	});

	test("refuses an option it does not have, and a positional", () => {
		expect(() => parseBoardArgs(["--root", "docs"])).toThrow("unknown option --root");
		expect(() => parseBoardArgs(["extra"])).toThrow("unexpected argument extra");
	});

	test("has no --viewer, because every page is one page now", () => {
		// The flag existed to photograph a second, read-only credential. There is one.
		expect(() => parseBoardArgs(["--viewer"])).toThrow("unknown option --viewer");
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

describe("posting card shot arguments", () => {
	test("captures every card at 2x by default", () => {
		const options = parseCardArgs([]);
		expect(options.cards).toEqual(["flow", "graphic", "board", "team", "parallel", "wechat", "ends"]);
		expect(options.out).toBe("");
		expect(options.scale).toBe(2);
		expect(options.waitMs).toBe(8000);
	});

	test("naming a card captures only it, and the flags override the defaults", () => {
		const options = parseCardArgs(["graphic", "-o", "shot.png", "--scale", "1", "--wait", "100"]);
		expect(options.cards).toEqual(["graphic"]);
		expect(basename(options.out)).toBe("shot.png");
		expect(options.scale).toBe(1);
		expect(options.waitMs).toBe(100);
	});

	test("several cards may be named at once, in the order given", () => {
		// The board pair is captured together in practice; the default set is no longer
		// the only way to ask for more than one card.
		expect(parseCardArgs(["board", "team"]).cards).toEqual(["board", "team"]);
	});

	test("rejects a fixed width, an unknown card, and one output for two cards", () => {
		const invalid: ReadonlyArray<readonly [argv: string[], message: string]> = [
			[["--width", "900"], "--width is fixed: a card sizes itself in its own stylesheet"],
			[["poster"], 'unknown card "poster"; expected flow, graphic, board, team, parallel, wechat, and ends'],
			[["-o", "shot.png"], "-o names one file; capture one card at a time"],
			[["board", "team", "-o", "shot.png"], "-o names one file; capture one card at a time"],
			[["--theme", "sepia"], "--theme must be light or dark"],
			[["--nope"], "unknown option --nope"],
		];
		for (const [argv, message] of invalid) {
			expect(() => parseCardArgs(argv), argv.join(" ")).toThrow(message);
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

/**
 * The plan paths the board's fixtures record.
 *
 * The shipped `contract` records only a plan inside this repository's store, and every spelling
 * here is built from the store it is proved against — which is what lets the seed run against a
 * temp directory here and against the real one in a capture.
 */
describe("board fixture plan paths", () => {
	/** An empty plan store of the fixture's own shape: `<agent-dir>/plans/<key>`. */
	function storeDir(): string {
		const dir = join(mkdtempSync(join(tmpdir(), "pi-board-fixture-plans-")), "plans", basename(fixturePlanDir()));
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	/** The plan each page card records, spelled against `dir` as the seeder spells it. */
	const recorded = (dir: string): string[] =>
		FIXTURE_CARDS.flatMap((card) =>
			"plan" in card && card.plan !== undefined ? [fixturePlanPath(dir, card.plan)] : [],
		);

	test("every plan a fixture records is one the shipped contract accepts", () => {
		const dir = storeDir();
		const plans = recorded(dir);
		// The four cards that leave the pool: a shape proved on nothing would pass as readily.
		expect(plans.length).toBe(4);
		for (const spelled of plans) {
			// One file directly in the store: `plan` action `write` makes no subdirectory of it.
			const name = spelled.slice(spelled.lastIndexOf("/") + 1);
			expect(name.endsWith(".md"), spelled).toBe(true);
			writeFileSync(join(dir, name), "# A fixture plan\n- [ ] one\n");
			expect(planForContract(dir, spelled), spelled).toEqual({ path: join(dir, name) });
		}
	});

	test("every plan the gallery names sits in the store the fixture derives", () => {
		// The gallery draws a `contract` call and proves nothing, so its path only has to name the
		// store a reader would open — the one `plan` action `write` saves into.
		const dir = fixturePlanDir();
		const named = FIXTURES.filter((fixture) => (fixture.tool ?? fixture.name) === "board")
			.map((fixture) => (fixture.args as { path?: unknown } | undefined)?.path)
			.filter((path): path is string => typeof path === "string");
		expect(named.length).toBeGreaterThan(0);
		for (const path of named) expect(isInside(dir, resolvePlanArg(dir, path)), path).toBe(true);
	});

	test("the relative spelling the fixtures used to carry is refused", () => {
		const dir = storeDir();
		// Resolved against the store, `plans/<id>.md` names a nested directory no writer makes,
		// which is why the shipped contract refuses it and the fixtures no longer spell it.
		const refused = planForContract(dir, "plans/3.md");
		expect("error" in refused).toBe(true);
	});
});

describe("plan fixture plan paths", () => {
	/** The store the plan tool writes into: `<agent-dir>/plans/<repo-key>`, under the fake home. */
	const STORE = "/home/u/.pi/agent/plans/8872d3adda0e/";

	/** The two fields a plan tool's result carries: the absolute path and the `~` form of it. */
	function planDetails(name: string): { path: string; relativePath: string } | undefined {
		const details: unknown = FIXTURES.find((item) => item.name === name)?.result?.details;
		if (typeof details !== "object" || details === null) return undefined;
		const path = "path" in details ? details.path : "planPath" in details ? details.planPath : undefined;
		const relativePath = "relativePath" in details ? details.relativePath : undefined;
		return typeof path === "string" && typeof relativePath === "string" ? { path, relativePath } : undefined;
	}

	test("every plan fixture names a plan the store could hold, in both forms the tool returns", () => {
		// The three actions whose result carries a plan: `write` and `exit` draw it.
		for (const name of ["plan-write", "plan-exit", "plan-steps"]) {
			const plan = planDetails(name);
			expect(plan, name).toBeDefined();
			if (plan === undefined) continue;
			expect(plan.path.startsWith(STORE), name).toBe(true);
			// One file directly in the store: the `write` action makes no subdirectory of it, and
			// the in-checkout `.pi/plans` directory it used to picture is the one nothing writes now.
			const fileName = plan.path.slice(STORE.length);
			expect(fileName.includes("/"), name).toBe(false);
			expect(fileName.endsWith(".md"), name).toBe(true);
			// The stored path and the path the user is shown are one path in two spellings.
			expect(plan.relativePath, name).toBe(plan.path.replace("/home/u", "~"));
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
