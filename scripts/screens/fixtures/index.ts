/**
 * The fixtures the docs screenshots are drawn around, one module per surface
 * (dev tooling).
 *
 * Each one is hand-written data for a real component: the todo list, a job
 * table, a rewind timeline, a plan, a watch list. They live here so `index.ts`
 * one level up is the frames and the capture is a separate module, and so a test
 * can render every frame without either.
 *
 * Nothing here touches a host surface or this machine: every path, domain, and
 * name is invented, so no capture prints a real checkout.
 */

export { AGENT_RUNS } from "./agents.ts";
export { CONTEXT_REPORT } from "./context.ts";
export { HERO_GOAL, HERO_TODOS } from "./hero.ts";
export { JOBS } from "./jobs.ts";
export { MEMORY_CALLBACKS, MEMORY_ENTRIES } from "./memory.ts";
export { PLAN, PLAN_BASELINE, PLAN_CONTENT, PLAN_PATH } from "./plan.ts";
export { QUESTIONS } from "./questions.ts";
export { REWIND_POINTS } from "./rewind.ts";
export { SCREEN_TUI, noop, now } from "./shared.ts";
export { BUS_BOARD } from "./session.ts";
export { TODOS } from "./todo.ts";
export { WATCHES } from "./watch.ts";
export { WECHAT_ACCOUNT, WECHAT_BRIDGE, WECHAT_VIEW } from "./wechat.ts";
export { WINDOW_BOUNDS } from "./window.ts";
export { WORKTREE_SNAPSHOT } from "./worktree.ts";
export { DEMO_CWD, DEMO_HOME, DEMO_PROJECT } from "./workspace.ts";
