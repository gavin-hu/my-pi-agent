# my-pi-agent

[English](./README.md) · **简体中文**

[![CI](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![built for Pi](https://img.shields.io/badge/built%20for-Pi-5A4FCF)](https://pi.dev)

先规划，再行动；委派工作，保持主检出区干净，并让上下文跨会话延续。
`my-pi-agent` 是一个 [Pi](https://pi.dev) 包，新增十六个扩展和两个主题 —— 安装
整个包，关掉你不需要的部分，其余照常使用 Pi。

![一个运行 Pi TUI 的终端窗口，包含 bytefly 头部、提示行、上下文与已加载扩展、回合分隔线以及状态栏](assets/chrome.png)

## 目录

- [为什么选择这个包](#为什么选择这个包)
- [快速开始](#快速开始)
- [包含内容](#包含内容)
- [配置](#配置)
- [文档](#文档)
- [环境要求](#环境要求)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 为什么选择这个包

Pi 提供一个精简而锐利的内核。这个包是在其之上的一层，面向希望智能体*先思考、
再安全行动*的人：

- **先规划，再执行。** 只读的规划模式把一次任务变成一份可审阅的计划文件，智能体
  随后按步骤执行。
- **委派与并行。** 在各自的 Pi 进程中运行专职子智能体来探索、审阅、测试或实现，
  你继续把握主线。
- **绝不搞乱检出区。** 工作发生在隔离的 `git worktree` 中，每次提示都会生成快照，
  因此一次糟糕的回合只需一个 `/rewind` 就能回退。
- **跨会话记忆。** 持久笔记以纯 Markdown 保存，可读、可改、可纳入版本控制。
- **连通网络与文件。** 搜索、抓取、浏览、打开和读取文档 —— 全部在会话内完成。

一切都是可选的，且可独立开关。没有任何东西被补丁或分叉：Pi 通过
[`package.json`](./package.json) 里的 `pi` manifest 发现这些资源，因此该包能像
其他包一样随 Pi 一起升级。

## 快速开始

需要一个可用的 [Pi](https://pi.dev) 安装。

```bash
pi install npm:@gavin-hu/my-pi-agent                       # 从 npm 安装
pi install git:github.com/gavin-hu/my-pi-agent             # 从 git 安装
pi install git:github.com/gavin-hu/my-pi-agent@v0.8.0      # 固定到某个版本
pi install ./ -l                                           # 仅项目本地（.pi/settings.json）
pi -e .                                                    # 试运行一次
```

然后在 Pi 中：

- `/bytefly [extension] [refresh]` 打开扩展屏幕，列出每个已加载扩展及其运行时健康
  状况，并启用或禁用一个扩展。
- `/bytefly doctor [extension] [refresh]` 打印 doctor 报告（`run_doctor` 的文本），
  检查每个已启用扩展在运行时是否具备所需条件。
- `/settings` → **Theme** 选择主题。
- `/plan <任务>` 以只读规划模式开始一个任务。

## 包含内容

十六个扩展和两个主题，按你想达成的目标分组。每个扩展自己的 `README.md` 提供完整的
工具与命令说明。

### 规划与委派

| 扩展 | 工具与命令 | 说明 |
|---|---|---|
| [`plan`](./extensions/plan/) | `enter_plan_mode`, `write_plan`, `exit_plan_mode`, `set_plan_steps`, `/plan`, `--plan` | 只读规划：模型先调研，把计划保存到 `.pi/plans` 下，你在写入任何内容前先批准。可在 TUI 中审阅，或在浏览器中打开以留下行内评论。 |
| [`subagent`](./extensions/subagent/) | `subagent` | 把任务委派给专职智能体（`explorer`、`planner`、`reviewer`、`worker`、`researcher`、`tester`、`debugger`、`documenter`），运行在它自己的 Pi 进程中 —— 单个、并行或链式。 |
| [`todo`](./extensions/todo/) | `todo`, `/todos` | 持久任务列表（`pending` / `in_progress` / `completed`），配一行式 widget。 |
| [`goal`](./extensions/goal/) | `goal`, `/goal` | 持久会话目标，保存在 widget 中，并在每个回合前重述。 |
| [`question`](./extensions/question/) | `ask_user_question` | 向你提出一个或多个结构化问题（带标签的选项外加自由填写的“其他”）并等待回答。 |
| [`job`](./extensions/job/) | `job`, `/jobs` | 在后台运行长时 shell 命令；查看日志、等待或结束它们。 |
| [`watch`](./extensions/watch/) | `watch`, `/watch` | 跟踪文件或命令输出，按模式匹配行，并提醒你或把匹配的行交给智能体。 |

### 保护你的工作

| 扩展 | 工具与命令 | 说明 |
|---|---|---|
| [`worktree`](./extensions/worktree/) | `enter_worktree`, `exit_worktree`, `prune_worktrees`, `list_worktrees`, `/worktree*`, `--worktree` | 在隔离的 `git worktree` 里、在独立分支上工作；内置的 read/write/edit/bash 工具会跟随，清理时也不会丢弃工作。 |
| [`rewind`](./extensions/rewind/) | `/rewind`, `↺ N` 状态标记 | 每次提示时在 `refs/pi/rewind` 下对仓库生成快照，可恢复代码、对话或两者。 |
| [`memory`](./extensions/memory/) | `memory`, `/memory` | 跨会话的持久笔记，以可人工编辑的 Markdown 保存，注入每次运行，并通过 `/memory` 选择器管理。 |

### 连通外部世界

| 扩展 | 工具与命令 | 说明 |
|---|---|---|
| [`web-access`](./extensions/web-access/) | `web_search`, `web_fetch` | 搜索网络（默认无密钥的 DuckDuckGo，可选 SearXNG 或 Brave），并把页面抓取为可读文本，支持分页、`find`、逐跳 SSRF 检查以及可选的 PDF 支持。 |
| [`file-browse`](./extensions/file-browse/) | `/browse` | 启动一个以工作目录为根的本地回环、只读文件浏览器，带 Markdown 预览和模糊快速打开面板。 |
| [`document`](./extensions/document/) | `read_doc` | 在进程内从本地 PDF、DOCX、DOC、ODT、RTF 或 XLSX 提取文本，支持分页。 |
| [`file-open`](./extensions/file-open/) | `/open`, `open_path` | 用操作系统原生应用打开或定位文件/目录。 |
| [`wechat`](./extensions/wechat/) | `/wechat`, `send_wechat` | 通过微信 iLink 机器人 API 把微信聊天桥接到实时会话；入站文本、图片和文件会变成回合。 |

### 界面与维护

| 扩展 | 工具与命令 | 说明 |
|---|---|---|
| [`bytefly`](./extensions/bytefly/) | `/bytefly`（`doctor` 子命令）、`run_doctor` | 主题化头部与宽度自适应页脚、已完成回合之间的分隔线、`/bytefly` 扩展屏幕——列出每个扩展及其健康状况并启用或禁用一个扩展（`/bytefly doctor` 打印 doctor 报告）；以及可选的 `notify` 能力：当一次运行或后台任务结束、或智能体请求输入时发出系统通知。DeepSeek 开箱即定价，`bytefly.json` 是每个扩展都会读取的共享配置文档。 |
| [`bytefly-dark`](./themes/bytefly-dark.json) / [`bytefly-light`](./themes/bytefly-light.json) | `/settings` → **Theme** | GitHub 风格的深色调色板及其浅色搭档，并支持可选的自动浅色/深色切换。 |

### 截图

<table>
<tr>
<td width="50%"><img src="assets/todo.png" alt="/todos 屏幕：Todos 标题线、3/7 完成摘要，以及带对勾、进行中和圆圈字形的列表" width="100%"></td>
<td width="50%"><img src="assets/question.png" alt="ask_user_question 对话框：Auth 与 Scope 标签页、问题、四个带说明的编号选项，以及导航提示" width="100%"></td>
</tr>
<tr>
<td width="50%"><img src="assets/job.png" alt="/jobs 屏幕：摘要行、带状态字形和耗时的任务行，以及焦点任务的命令、工作目录和最后一行输出" width="100%"></td>
<td width="50%"><img src="assets/rewind.png" alt="/rewind 屏幕：从新到旧的提示行、标记有代码快照的菱形，以及焦点提示的快照详情" width="100%"></td>
</tr>
</table>

### 工具渲染

每个工具块都按转录中的样子绘制：工具自身的调用行作为无 rail 的标题，共用 rail 包住其下方的
正文（每个工具自身的渲染器或 bytefly 的通用回退）——用户铭牌与通知、Pi 内置工具，以及本包注册的每个工具。

![每个工具块的全页参考图：用户铭牌、通知、回合分隔线，Pi 的 read、write、edit、bash、grep、find、ls 渲染器，以及每个包内工具——todo、goal、memory、job、watch、subagent、web_search、web_fetch、read_doc、open_path、run_doctor、send_wechat、ask_user_question、plan 工具与 worktree 工具](assets/tool-renderings.png)

`bun run screenshot:tools` 重新生成它；`bun run screenshot:tool-pngs` 在
[`assets/tools/`](./assets/tools) 下为每个工具输出一张图。

## 配置

大多数扩展无需配置。所有设置都在一个共享文档 `bytefly.json` 中，从
`<agent-dir>/bytefly.json` 读取，并与 `<cwd>/.pi/bytefly.json` 合并（项目优先），
位于一个以扩展名命名的顶层 section 下。每个扩展的 `README.md` 列出它的键，
[`docs/configuration.md`](./docs/configuration.md) 为其建立索引，
[`assets/bytefly.schema.json`](./assets/bytefly.schema.json) 校验该文件。

每个扩展默认都开启。若要在加载整包时排除其中一些，把 `PI_DISABLED_EXTENSIONS`
设为一个以逗号或空白分隔的扩展名列表（即 [`extensions/`](./extensions/) 下的目录
名）：

```bash
PI_DISABLED_EXTENSIONS=todo,job pi -e .
```

名称比较不区分大小写，未知名称会被忽略。这只会阻止工厂注册；若要移除整包，请使用
Pi 的 `--no-extensions`，或从你的设置中删除该包。

## 文档

| 指南 | 内容 |
|---|---|
| [快速开始](./docs/getting-started.md) | 环境要求、安装选项、验证加载、主题。 |
| [扩展](./docs/extensions.md) | 所有扩展与主题的完整目录。 |
| [配置](./docs/configuration.md) | 配置文件解析、按扩展索引、环境变量。 |
| [架构](./docs/architecture.md) | 包、各扩展与 `lib/` 如何协同。 |
| [开发](./docs/development.md) | 本地设置、检查、测试、跨平台注意事项与发布流程。 |
| [安全](./docs/security.md) | 回环与远程界面的信任边界。 |

## 环境要求

- **Pi** —— 需要一个可用的安装；`my-pi-agent` 是一个包，不是分叉。
- **操作系统** —— Windows、macOS 和 Linux；完整检查套件在三者的 CI 上都会运行。
- **git** 需在 `PATH` 上，供 `worktree` 和 `rewind` 扩展使用；其余部分会优雅降级或
  禁用，`/bytefly doctor` 会告诉你缺什么。
- 可选的运行时组件（例如用于 HTML 导出的浏览器）由 `/bytefly doctor` 按扩展报告。

## 参与贡献

欢迎贡献。请先阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)，了解设置、worktree
分支流程以及改动必须通过的检查。AI 编码智能体应阅读
[`AGENTS.md`](./AGENTS.md)。

## 许可证

MIT
