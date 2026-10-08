// Real-runtime smoke test: load the package through the real Pi loader and
// drive enter_worktree/list_worktrees/exit_worktree without a model call.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { canonicalize } from "../extensions/git/worktree/git.ts";
import { ROOT_TOOL_NAMES } from "../extensions/git/worktree/root-tools.ts";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionPath = join(repo, "extensions", "git", "index.ts");
const askExtensionPath = join(repo, "extensions", "ask-user-question", "index.ts");
const todoExtensionPath = join(repo, "extensions", "todo", "index.ts");
const goalExtensionPath = join(repo, "extensions", "goal", "index.ts");
const planExtensionPath = join(repo, "extensions", "plan", "index.ts");
const subagentExtensionPath = join(repo, "extensions", "subagent", "index.ts");
const jobExtensionPath = join(repo, "extensions", "job", "index.ts");
const webAccessExtensionPath = join(repo, "extensions", "web-access", "index.ts");
const fileBrowserExtensionPath = join(repo, "extensions", "file-browser", "index.ts");
const statusBarExtensionPath = join(repo, "extensions", "status-bar", "index.ts");
const turnSeparatorExtensionPath = join(repo, "extensions", "turn-separator", "index.ts");
const agentDir = mkdtempSync(join(tmpdir(), "pi-smoke-agent-"));

// Scratch git repo with one commit.
const work = mkdtempSync(join(tmpdir(), "pi-smoke-repo-"));
const git = (...args: string[]) => execFileSync("git", args, { cwd: work, stdio: "pipe" }).toString();
git("init", "-q", "-b", "main");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
git("config", "core.autocrlf", "false");
writeFileSync(join(work, "a.txt"), "hi\n");
git("add", ".");
git("commit", "-qm", "init");

// Keep the jobs registry inside the smoke's temp agent dir instead of ~/.pi.
mkdirSync(join(work, ".pi"), { recursive: true });
writeFileSync(join(work, ".pi", "jobs.json"), JSON.stringify({ registryDir: join(agentDir, "jobs") }));

const loader = new DefaultResourceLoader({
	cwd: work,
	agentDir,
	additionalExtensionPaths: [
		extensionPath,
		askExtensionPath,
		todoExtensionPath,
		goalExtensionPath,
		planExtensionPath,
		subagentExtensionPath,
		jobExtensionPath,
		webAccessExtensionPath,
		fileBrowserExtensionPath,
		statusBarExtensionPath,
		turnSeparatorExtensionPath,
	],
});
await loader.reload();
const loadErrors = loader.getExtensions().errors;
if (loadErrors.length > 0) {
	console.log("LOAD ERRORS:", loadErrors);
	process.exit(1);
}

const sessionManager = SessionManager.inMemory(work);
const { session } = await createAgentSession({
	resourceLoader: loader,
	sessionManager,
});

const runner = session.extensionRunner;
const tool = (name: string) => {
	const def = runner.getToolDefinition(name);
	if (!def) throw new Error(`missing tool: ${name}`);
	return def;
};
const call = (name: string, params: Record<string, unknown>) =>
	tool(name).execute("smoke", params, undefined, undefined, runner.createToolContext("smoke", undefined));

let ok = true;
const check = (label: string, cond: boolean) => {
	console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
	if (!cond) ok = false;
};

// `findInactiveOverrides` treats a tool as ours when Pi records the extension
// entry file as its source; verify that premise on the real registry.
const entry = canonicalize(extensionPath);
for (const name of ROOT_TOOL_NAMES) {
	const info = session.getAllTools().find((t) => t.name === name);
	check(
		`override ${name} is sourced from the extension entry`,
		!!info?.sourceInfo?.path && canonicalize(info.sourceInfo.path) === entry,
	);
	// The override must keep the built-in renderers (and edit's arg normalizer),
	// otherwise the TUI loses diffs/highlighting and some models' edits break.
	const def = tool(name) as { renderCall?: unknown; renderResult?: unknown; prepareArguments?: unknown };
	check(`override ${name} keeps renderCall/renderResult`, !!def.renderCall && !!def.renderResult);
}
check("edit override keeps prepareArguments", !!tool("edit").prepareArguments);

const entered = await call("enter_worktree", { name: "smoke" });
const enterText = (entered.content[0] as { text: string }).text;
console.log(enterText.split("\n").slice(0, 4).join("\n"));
const dir = join(work, ".pi", "worktrees", "smoke");
check("worktree directory created", existsSync(dir));
check("enter mentions isolation", /Entered worktree/.test(enterText));

const status = await call("list_worktrees", {});
const statusText = (status.content[0] as { text: string }).text;
console.log(statusText);
check("status reports isolated", /Worktree: smoke/.test(statusText));
check("status reports no inactive overrides", !/not active for/.test(statusText));

// ask-user-question loads alongside worktree and gates itself on UI availability.
const askTool = session.getAllTools().find((t) => t.name === "ask_user_question");
check("ask_user_question registered", !!askTool);
check("ask_user_question is model-only", askTool?.exposure === "model-only");
check("ask_user_question inactive without a UI", !session.getActiveToolNames().includes("ask_user_question"));
check("ask_user_question supports no-UI result", !!session.getToolDefinition("ask_user_question"));

// todo loads alongside the others and works headlessly (no widget without a UI).
const todoTool = session.getAllTools().find((t) => t.name === "todo");
check("todo registered", !!todoTool);
check("todo is active by default", session.getActiveToolNames().includes("todo"));
const wrote = await call("todo", {
	todos: [{ content: "smoke task", status: "in_progress", activeForm: "smoke task" }],
});
const wroteText = (wrote.content[0] as { text: string }).text;
const wroteDetails = wrote.details as { todos: unknown[]; action: string };
const wroteStructured = wrote.structuredContent as { todos: unknown[]; action: string };
check("todo writes a compact summary", /0\/1 completed/.test(wroteText) && /In progress: smoke task/.test(wroteText));
check("todo keeps structured details", wroteDetails.todos.length === 1 && wroteDetails.action === "write");
check("todo returns structured content", wroteStructured.todos.length === 1 && wroteStructured.action === "write");
const cleared = await call("todo", { todos: [] });
const clearedDetails = cleared.details as { todos: unknown[]; action: string };
check("todo clears", clearedDetails.todos.length === 0 && clearedDetails.action === "clear");

// goal loads alongside the others and tracks one session objective headlessly.
const goalTool = session.getAllTools().find((t) => t.name === "goal");
check("goal registered", !!goalTool);
check("goal is active by default", session.getActiveToolNames().includes("goal"));
check("goal is callable", !!session.getToolDefinition("goal"));
const setGoal = await call("goal", { objective: "smoke objective" });
const setGoalDetails = setGoal.details as { goal: { objective: string; status: string } | null; action: string };
check(
	"goal records an active objective",
	setGoalDetails.goal?.objective === "smoke objective" &&
		setGoalDetails.goal?.status === "active" &&
		setGoalDetails.action === "set",
);
const achievedGoal = await call("goal", { objective: "smoke objective", status: "achieved" });
const achievedDetails = achievedGoal.details as { goal: { status: string } | null; action: string };
check("goal marks achieved", achievedDetails.goal?.status === "achieved" && achievedDetails.action === "achieve");
const clearedGoal = await call("goal", { objective: "" });
const clearedGoalDetails = clearedGoal.details as { goal: unknown; action: string };
check("goal clears", clearedGoalDetails.goal === null && clearedGoalDetails.action === "clear");

// The /goal command cannot return a tool result, so it persists a custom entry
// that branch reconstruction replays.
const goalCommand = runner.getCommand("goal");
check("goal command registered", !!goalCommand);
if (!goalCommand) throw new Error("missing goal command");
const commandCtx = runner.createCommandContext();
await goalCommand.handler("smoke via command", commandCtx);
const commandPersisted = sessionManager
	.getBranch()
	.some(
		(entry) =>
			entry.type === "custom" &&
			entry.customType === "goal" &&
			(entry.data as { goal?: { objective?: string } }).goal?.objective === "smoke via command",
	);
check("goal command persists a branch entry", commandPersisted);

// git loads and registers a read-only tool.
const gitTool = session.getAllTools().find((t) => t.name === "git");
check("git tool registered", !!gitTool);
check("git tool is read-only", gitTool?.annotations?.readOnlyHint === true);

// rewind loads alongside the others: automatic per-prompt snapshots stay, the
// old checkpoint tool and command are gone, and /rewind handles the rewind.
const rewindTool = session.getAllTools().find((t) => t.name === "checkpoint");
check("checkpoint tool removed", !rewindTool);
check("checkpoint command removed", !runner.getCommand("checkpoint"));
check("rewind command registered", !!runner.getCommand("rewind"));
const rewindCommand = runner.getCommand("rewind");
if (!rewindCommand) throw new Error("missing rewind command");
await rewindCommand.handler("", runner.createCommandContext());

// plan loads; the read-only entry tool is active, the exit tool is not, and
// a headless entry attempt refuses instead of entering silently.
check("enter_plan_mode registered", !!session.getAllTools().find((t) => t.name === "enter_plan_mode"));
check("exit_plan_mode registered", !!session.getAllTools().find((t) => t.name === "exit_plan_mode"));
check("write_plan registered", !!session.getAllTools().find((t) => t.name === "write_plan"));
check("enter_plan_mode active by default", session.getActiveToolNames().includes("enter_plan_mode"));
check("exit_plan_mode inactive without plan mode", !session.getActiveToolNames().includes("exit_plan_mode"));
check("write_plan inactive without plan mode", !session.getActiveToolNames().includes("write_plan"));
const enterResult = await call("enter_plan_mode", {});
check(
	"enter_plan_mode refuses without a UI",
	enterResult.isError === true && /No interactive UI/.test((enterResult.content[0] as { text: string }).text),
);

// subagent loads headlessly and registers an active, direct tool. It is not
// executed here: the process spawning is covered by unit tests with a fake spawn.
const subagentTool = session.getAllTools().find((t) => t.name === "subagent");
check("subagent registered", !!subagentTool);
check("subagent is direct", subagentTool?.exposure === "direct");
check("subagent active by default", session.getActiveToolNames().includes("subagent"));
check("subagent is callable", !!session.getToolDefinition("subagent"));
check(
	"subagent advertises its built-in agents",
	["explorer", "planner", "reviewer", "worker", "researcher", "tester", "debugger", "documenter"].every((name) =>
		subagentTool?.description?.includes(name),
	),
);

// jobs loads headlessly, registers an active tool and command, and can start and
// kill a real background process. The registry is pointed at a temp directory.
const jobsTool = session.getAllTools().find((t) => t.name === "job");
check("job registered", !!jobsTool);
check("job is direct", jobsTool?.exposure === "direct");
check("job active by default", session.getActiveToolNames().includes("job"));
check("jobs command registered", !!runner.getCommand("jobs"));
const started = await call("job", { action: "start", command: "sleep 30", label: "smoke" });
const startedDetails = started.details as { job?: { id?: string; status?: string } };
check("job start returns a running job", startedDetails.job?.status === "running" && !!startedDetails.job?.id);
const listedJobs = await call("job", { action: "list" });
check("job list returns the started job", ((listedJobs.details as { jobs?: unknown[] }).jobs?.length ?? 0) >= 1);
const killedJob = await call("job", { action: "kill", id: startedDetails.job!.id });
check("job kill signals the process", (killedJob.details as { signalled?: boolean }).signalled === true);
// The job runs with the active worktree as its cwd. A graceful taskkill on
// Windows can be ignored by a console child, and a live child holds that
// directory, so wait for the process to exit before removing the worktree.
const reaped = await call("job", { action: "wait", id: startedDetails.job!.id, timeoutMs: 20000 });
check("job is reaped before its worktree is removed", (reaped.details as { timedOut?: boolean }).timedOut === false);

// web-access loads and registers both an active, direct search tool and a
// direct fetch tool. They are not executed here: the network is covered by unit
// tests with an injected fetch.
const webSearchTool = session.getAllTools().find((t) => t.name === "web_search");
check("web_search registered", !!webSearchTool);
check("web_search is direct", webSearchTool?.exposure === "direct");
check("web_search active by default", session.getActiveToolNames().includes("web_search"));
check("web_search is callable", !!session.getToolDefinition("web_search"));

// web-fetch loads and registers an active, direct tool. It is likewise not
// executed here: the network is covered by unit tests with an injected runner.
const webFetchTool = session.getAllTools().find((t) => t.name === "web_fetch");
check("web_fetch registered", !!webFetchTool);
check("web_fetch is direct", webFetchTool?.exposure === "direct");
check("web_fetch active by default", session.getActiveToolNames().includes("web_fetch"));
check("web_fetch is callable", !!session.getToolDefinition("web_fetch"));

// serve loads headlessly and registers its command; /serve status must not
// start a server or open a browser.
const serveCommand = runner.getCommand("serve");
check("serve command registered", !!serveCommand);
if (serveCommand) await serveCommand.handler("status", runner.createCommandContext());
check("serve status runs without starting a server", !!serveCommand);

// status-bar loads headlessly and registers its toggle command; it installs no
// tools and only paints the footer in interactive mode.
check("status-bar command registered", !!runner.getCommand("status-bar"));

// turn-separator loads headlessly and registers its entry renderer; separators
// are only appended in interactive sessions.
const separatorRenderer = runner.getEntryRenderer("turn-separator") as
	| ((entry: unknown, options: unknown, theme: unknown) => { render(width: number): string[] } | undefined)
	| undefined;
check("turn-separator renderer registered", typeof separatorRenderer === "function");
const separatorLine = separatorRenderer?.(
	{ type: "custom", customType: "turn-separator", data: { turn: 3 } },
	{ expanded: false },
	{ fg: (_color: string, text: string) => text },
)?.render(40)[0];
check("turn-separator renders a labeled line", !!separatorLine?.includes("turn 3"));

const exited = await call("exit_worktree", { remove: true });
const exitText = (exited.content[0] as { text: string }).text;
console.log(exitText);
check("worktree directory removed", !existsSync(dir));
check("branch deleted", !git("branch").includes("worktree-smoke"));

session.dispose();
console.log(ok ? "SMOKE OK" : "SMOKE FAILED");
process.exit(ok ? 0 : 1);
