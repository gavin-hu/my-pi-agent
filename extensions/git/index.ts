/**
 * git — one extension composing the read-only `git` tool with worktree
 * isolation and rewind snapshots.
 *
 * The three formerly separate extensions now live here:
 *   - `tool.ts`     — the read-only `git` tool (`status`, `diff`, `log`,
 *                     `show`, `branch`);
 *   - `worktree/`   — isolated `git worktree` lifecycle and built-in tool
 *                     re-rooting (`enter_worktree` / `exit_worktree` /
 *                     `prune_worktrees` / `list_worktrees`, `/worktree*`);
 *   - `rewind/`     — automatic per-prompt snapshots and `/rewind`.
 *
 * Worktree registers first so its built-in tool overrides keep the precedence
 * they had when it was the first entry in the package manifest.
 *
 * Load with:  pi --extension ./extensions/git
 */

import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRewind } from "./rewind/index.ts";
import { registerGitTool } from "./tool/index.ts";
import { canonicalize } from "./worktree/git.ts";
import { registerWorktree } from "./worktree/index.ts";

export default function gitExtensions(pi: ExtensionAPI): void {
	registerWorktree(pi, { entryPath: canonicalize(fileURLToPath(import.meta.url)) });
	registerGitTool(pi);
	registerRewind(pi);
}
