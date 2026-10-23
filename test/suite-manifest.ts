/**
 * The grouped test-suite manifest.
 *
 * `EXTENSION_SUITES`, `LIB_SUITES`, and `SCRIPT_SUITES` are the complete layout:
 * a suite stem is relative to its owner directory and omits `.test.ts`. Every
 * test file under `extensions/`, `lib/`, and `scripts/` must be declared here;
 * `test/structure.test.ts` enforces that and requires each declared suite.
 */

export const EXTENSION_SUITES: Record<string, readonly string[]> = {
	bytefly: [
		"block/block",
		"chrome",
		"doctor/doctor",
		"footer/footer",
		"notify/notify",
		"panel/panel",
		"panel/skills",
		"picker/picker",
		"update/update",
		"working/working",
		"extension",
	],
	check: ["check", "surface", "extension"],
	context: ["report", "tui", "extension"],
	"file-read": ["extract/extract", "tool"],
	"file-browse": ["pages", "router", "files", "config"],
	"file-open": ["extension"],
	goal: ["format", "tools", "runtime", "extension"],
	job: ["runtime", "tools", "tui", "extension"],
	memory: ["store", "format", "tools", "tui"],
	plan: ["plans", "feedback", "tools", "review-prompt", "web", "web-share", "commands", "runtime", "tui", "extension"],
	question: ["tools", "tui", "extension"],
	rewind: ["store", "review", "runtime", "extension"],
	subagent: ["agents", "run", "render", "extension"],
	todo: ["tools", "runtime", "ui"],
	watch: ["runtime", "tools", "ui"],
	"session-bus": ["format", "protocol", "store", "runtime", "tui", "tools", "extension"],
	"web-access": ["fetch/fetch", "search/search", "http"],
	wechat: ["bridge", "client", "commands", "config", "peer", "status", "tools", "extension"],
	worktree: ["git", "flow", "ui"],
};

export const LIB_SUITES: readonly string[] = [
	"core",
	"format",
	"lines",
	"process",
	"report",
	"state",
	"requirements",
	"screen-session",
	"timer",
	"git/index",
	"http/http",
	"tui/layout",
	"tui/components",
	"tui/interaction",
	"tui/tool",
	"web/web",
];

export const SCRIPT_SUITES: readonly string[] = ["screenshots", "release", "render-bench"];
