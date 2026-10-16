/**
 * Render every tool's call and result as the transcript draws it (dev tooling).
 *
 * The blocks are produced by the shipped code, not a mock: the built-ins come
 * from Pi's public `createXToolDefinition(cwd)` factories (which carry the real
 * renderers — diffs, syntax highlighting, previews), the package's tools are
 * registered on a fake `ExtensionAPI` exactly as Pi loads them, and both are
 * resolved through bytefly's own `registerToolBlocks` resolver — so the rail,
 * its status colour, and the generic fallback are the ones a session shows.
 *
 *   tool-renderings.ts list                     one line per rendering
 *   tool-renderings.ts render <name> [--width]  print one block's ANSI
 *   tool-renderings.ts html <out.html>          write the gallery page
 *   tool-renderings.ts gallery <out.png>        capture the gallery full-page
 *   tool-renderings.ts tools <dir>              one PNG per rendering
 *
 * Fixtures live in `tool-fixtures.ts`; this module is the plumbing.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	type AgentToolResult,
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	getMarkdownTheme,
	type Theme,
	type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { NoticeComponent } from "../extensions/bytefly/notice/component.ts";
import { SeparatorComponent } from "../extensions/bytefly/separator/component.ts";
import { nameplate } from "../extensions/bytefly/message/format.ts";
import bytefly from "../extensions/bytefly/index.ts";
import document from "../extensions/document/index.ts";
import goal from "../extensions/goal/index.ts";
import jobs from "../extensions/job/index.ts";
import memory from "../extensions/memory/index.ts";
import planMode from "../extensions/plan/index.ts";
import question from "../extensions/question/index.ts";
import subagent from "../extensions/subagent/index.ts";
import todo from "../extensions/todo/index.ts";
import watch from "../extensions/watch/index.ts";
import webAccess from "../extensions/web-access/index.ts";
import wechat from "../extensions/wechat/index.ts";
import type { NoticeDetails } from "../lib/notice.ts";
import {
	loadThemeFromPath,
	setThemeInstance,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { createFakePi } from "../test/helpers/fakes.ts";
import { ansiLinesToHtml } from "./ansi-html.ts";
import { captureFullPage } from "./chrome-shot.ts";
import { FIXTURES, type ToolFixture } from "./tool-fixtures.ts";

const repo = resolve(import.meta.dir, "..");
const theme: Theme = loadThemeFromPath(join(repo, "themes", "bytefly-dark.json"), "truecolor");

/** Columns the gallery blocks are wrapped at. */
const DEFAULT_WIDTH = 100;
/** A synthetic cwd, so a capture never names the real workspace. */
const CWD = "/home/u/repo/project";

/** The extensions whose tools carry a renderer, in Pi's manifest order. */
const EXTENSIONS = [
	bytefly,
	document,
	goal,
	jobs,
	memory,
	planMode,
	question,
	subagent,
	todo,
	watch,
	webAccess,
	wechat,
];

/** The notice the transcript entry shows. */
const NOTICE: NoticeDetails = {
	source: "job",
	title: "2 background jobs finished",
	items: [
		{ label: "j1 build", detail: "exit 0", severity: "ok" },
		{ label: "j2 test", detail: "exit 1", severity: "bad" },
	],
};

/** Pi's built-in definitions, which carry the built-in renderers. */
function builtinDefinitions(): Record<string, ToolRenderers> {
	// Each definition is typed to its own args, which is narrower than the
	// resolver's `unknown`, so the renderers are taken as-is.
	return {
		read: createReadToolDefinition(CWD) as unknown as ToolRenderers,
		write: createWriteToolDefinition(CWD) as unknown as ToolRenderers,
		edit: createEditToolDefinition(CWD) as unknown as ToolRenderers,
		bash: createBashToolDefinition(CWD) as unknown as ToolRenderers,
		grep: createGrepToolDefinition(CWD) as unknown as ToolRenderers,
		find: createFindToolDefinition(CWD) as unknown as ToolRenderers,
		ls: createLsToolDefinition(CWD) as unknown as ToolRenderers,
	};
}

/**
 * Register every extension on a fake `pi` and hand back bytefly's resolver plus
 * the registered tools. Registration is all a factory does, so no session,
 * runtime, or disk is needed.
 */
function harness(): {
	resolve: (name: string, base: () => ToolRenderers | undefined) => ToolRenderers | undefined;
	tools: Map<string, ToolRenderers & { name?: string }>;
} {
	const fake = createFakePi();
	for (const extension of EXTENSIONS) (extension as (pi: unknown) => void)(fake.pi);
	const resolver = fake.toolRenderers[0];
	if (!resolver) throw new Error("bytefly registered no tool-renderer resolver");
	return { resolve: (name, base) => resolver(name, base), tools: fake.tools };
}

/** The render context a top-level tool row gets. */
function context(fixture: ToolFixture): any {
	return {
		args: fixture.args ?? {},
		toolCallId: `call-${fixture.name}`,
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: CWD,
		executionStarted: true,
		argsComplete: fixture.options?.argsComplete ?? true,
		isPartial: fixture.options?.isPartial ?? false,
		expanded: fixture.options?.expanded ?? false,
		showImages: false,
		isError: fixture.result?.isError ?? false,
		durationMs: fixture.options?.durationMs,
	};
}

/** A tool block: the call and its result, as the transcript shows them. */
function toolLines(
	resolve: ReturnType<typeof harness>["resolve"],
	fixture: ToolFixture,
	base: ToolRenderers | undefined,
	width: number,
): string[] {
	const wrapped = resolve(fixture.name, () => base);
	if (!wrapped) return [`(no renderer for ${fixture.name})`];
	const ctx = context(fixture);
	// Build both components first: a result can update the call component it
	// shares state with (edit moves its diff onto the call), so the call is
	// rendered only after the result has had its say.
	const call = wrapped.renderCall?.(ctx.args, theme, ctx);
	let resultComponent;
	if (wrapped.renderResult && fixture.result) {
		const result = fixture.result as unknown as AgentToolResult<unknown>;
		const options = { expanded: ctx.expanded, isPartial: ctx.isPartial };
		resultComponent = wrapped.renderResult(result, options, theme, ctx);
	}
	const lines: string[] = [];
	if (call) lines.push(...call.render(width));
	if (resultComponent) lines.push(...resultComponent.render(width));
	return lines;
}

/** A transcript surface, drawn by bytefly's own component. */
function transcriptLines(name: string, width: number): string[] {
	if (name === "user-message") {
		const plate = nameplate(width);
		const lines: string[] = [];
		if (plate) lines.push(...new Markdown(plate, 0, 0, getMarkdownTheme()).render(width));
		lines.push("", theme.fg("text", "Which retry policy should I implement?"), "");
		return lines;
	}
	if (name === "notice") return new NoticeComponent(NOTICE, theme).render(width);
	if (name === "turn-rule") return new SeparatorComponent(4, theme).render(width);
	return [];
}

/** One rendering: the call and result (or the transcript surface) at a width. */
export interface Rendering {
	name: string;
	group: ToolFixture["group"];
	label: string;
	lines(width: number): string[];
}

/** The names of every tool the package's extensions register. */
export function registeredToolNames(): string[] {
	return [...harness().tools.keys()].sort();
}

/** Every rendering, in gallery order. */
export function renderings(): Rendering[] {
	setThemeInstance(theme);
	const { resolve, tools } = harness();
	const builtins = builtinDefinitions();
	return FIXTURES.map((fixture) => ({
		name: fixture.name,
		group: fixture.group,
		label: fixture.label,
		lines: (width: number): string[] => {
			setThemeInstance(theme);
			if (fixture.group === "transcript") return transcriptLines(fixture.name, width);
			const base = fixture.group === "builtin" ? builtins[fixture.name] : tools.get(fixture.name);
			return toolLines(resolve, fixture, base, width);
		},
	}));
}

/** Escape text for an HTML text node. */
function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One labelled block. */
function blockHtml(rendering: Rendering, width: number): string {
	const body = ansiLinesToHtml(rendering.lines(width));
	return `<figure class="block"><figcaption>${escapeHtml(rendering.name)}<span>${escapeHtml(rendering.label)}</span></figcaption><pre>${body}</pre></figure>`;
}

/** The page chrome every capture shares. */
function page(title: string, subtitle: string, width: number, body: string): string {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
	:root { color-scheme: dark; }
	body { margin: 0; background: #0d1117; color: #c9d1d9;
		font: 13px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
	main { padding: 28px 32px 48px; }
	h1 { font-size: 15px; margin: 0; color: #58a6ff; }
	.sub { margin: 4px 0 0; color: #8b949e; font-size: 12px; }
	section { margin-top: 26px; }
	h2 { font-size: 12px; letter-spacing: .10em; text-transform: uppercase;
		color: #8b949e; margin: 0; border-bottom: 1px solid #484f58; padding-bottom: 5px; }
	.block { margin: 14px 0 0; }
	figcaption { color: #58a6ff; font-size: 12px; }
	figcaption span { color: #6e7681; margin-left: 8px; }
	pre { margin: 5px 0 0; white-space: pre; font: inherit; width: ${width}ch; }
</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(subtitle)}</p>
${body}
</main></body></html>`;
}

/** The full gallery: one section per group. */
export function galleryHtml(width = DEFAULT_WIDTH): string {
	const all = renderings();
	const groups: Array<{ key: Rendering["group"]; title: string; note: string }> = [
		{ key: "transcript", title: "Transcript", note: "the user nameplate, a notice, and the turn rule" },
		{ key: "builtin", title: "Pi built-ins", note: "real renderers: diffs, highlighting, previews" },
		{ key: "package", title: "Package tools", note: "each extension's own renderer, or the generic fallback" },
	];
	const sections = groups
		.map((group) => {
			const items = all.filter((rendering) => rendering.group === group.key);
			if (items.length === 0) return "";
			const blocks = items.map((rendering) => blockHtml(rendering, width)).join("\n");
			return `<section><h2>${escapeHtml(group.title)} — ${escapeHtml(group.note)}</h2>\n${blocks}\n</section>`;
		})
		.filter(Boolean)
		.join("\n");
	return page(
		"Tool call & result renderings",
		`Every tool block as the transcript draws it, wrapped at ${width} columns.`,
		width,
		sections,
	);
}

/** A page holding exactly one block, for a per-tool capture. */
function singleHtml(rendering: Rendering, width = DEFAULT_WIDTH): string {
	return page(rendering.name, rendering.label, width, blockHtml(rendering, width));
}

/** A number flag from the arguments, or a fallback. */
function numberArg(args: string[], flag: string, fallback: number): number {
	const index = args.indexOf(flag);
	if (index < 0) return fallback;
	const value = Number.parseInt(args[index + 1] ?? "", 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Write `html` to a temp file, capture it full-page, and remove the file. */
async function captureHtml(html: string, out: string, width: number): Promise<void> {
	const dir = mkdtempSync(`${tmpdir()}/tool-renderings-`);
	const file = join(dir, "page.html");
	mkdirSync(dirname(out), { recursive: true });
	try {
		writeFileSync(file, html);
		await captureFullPage({ url: `file://${file}`, origin: "file://", out, width });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];
	const width = numberArg(args, "--width", DEFAULT_WIDTH);
	if (command === "list") {
		for (const rendering of renderings()) {
			console.log(`${rendering.group.padEnd(10)} ${rendering.name.padEnd(18)} ${rendering.label}`);
		}
		return;
	}
	if (command === "render") {
		const rendering = renderings().find((item) => item.name === args[1]);
		if (!rendering) throw new Error(`unknown rendering "${args[1]}"`);
		process.stdout.write(`${rendering.lines(width).join("\n")}\n`);
		return;
	}
	if (command === "html") {
		const out = resolve(args[1] ?? "tool-renderings.html");
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, galleryHtml(width));
		console.log(out);
		return;
	}
	if (command === "gallery") {
		const out = resolve(args[1] ?? "tool-renderings.png");
		await captureHtml(galleryHtml(width), out, width);
		console.log(out);
		return;
	}
	if (command === "tools") {
		const dir = resolve(args[1] ?? "assets/tools");
		mkdirSync(dir, { recursive: true });
		for (const rendering of renderings()) {
			const out = join(dir, `${rendering.name}.png`);
			await captureHtml(singleHtml(rendering, width), out, width);
			console.log(out);
		}
		return;
	}
	throw new Error("usage: tool-renderings.ts <list|render|html|gallery|tools> [name|out] [--width n]");
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
