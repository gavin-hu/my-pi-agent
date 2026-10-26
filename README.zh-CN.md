# my-pi-agent

[English](./README.md) · **简体中文**

[![CI](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40gavin-hu%2Fmy-pi-agent)](https://www.npmjs.com/package/@gavin-hu/my-pi-agent)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![built for Pi](https://img.shields.io/badge/built%20for-Pi-5A4FCF)](https://pi.dev)

`my-pi-agent` 是一个 [Pi](https://pi.dev) 包，在你已经使用的智能体之上新增一组精选
扩展、技能和主题 —— 安装整个包，关掉你不需要的部分，其余照常使用 Pi。

本页是目录与安装说明。要了解某个功能怎么用 —— 按键、命令以及应有的效果 ——
请先看[用户指南](./docs/user-guide/)。

![一个运行 Pi TUI 的终端窗口：bytefly 头部标出 Pi 与 bytefly 的版本、三行按键提示、带名板的消息及其回答与编辑差异（位于竖线内）、两个后台任务完成的通知（一个通过的测试任务与一个失败的构建任务）、回合分隔线、目标与待办栏、夹在两条横线之间且已输入半句的输入框，以及两行页脚（上下文指示、按价目计算的费用、模型名）](assets/screens/chrome.png)

## 目录

- [为什么选择这个包](#为什么选择这个包)
- [快速开始](#快速开始)
- [包含内容](#包含内容)
- [配置](#配置)
- [文档](#文档)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 为什么选择这个包

Pi 提供一个精简而锐利的内核。这个包是在其之上的一层，面向希望智能体*先思考、
再安全行动*的人：

- **先规划，再执行。** 只读的规划模式把一次任务变成一份可审阅的计划文件，智能体
  随后按步骤执行。
- **委派与并行。** 在各自的 Pi 进程中运行专职子智能体，把耗时构建交给后台任务，
  让 watcher 盯住日志直到出现关键行，还能让同一仓库上的多个会话通过共享总线协作、
  各自负责自己的一摊 —— 你继续把握主线。
- **绝不搞乱检出区。** 隔离只需一条命令：任务切到自己分支的 `git worktree` 中，
  每次提示的首次改动都会生成快照，因此一次糟糕的回合只需一个 `/rewind` 就能回退。
- **跨会话记忆。** 持久笔记以纯 Markdown 保存，可读、可改、可纳入版本控制。
- **连通网络与文件。** 在会话内搜索、抓取、浏览、打开和读取文档与表格，还可通过桥接
  在微信里直接回答当前会话。

一切都是可选的，且可独立开关。没有任何东西被分叉，也没有写入任何已安装的 Pi 文件：
Pi 通过 [`package.json`](./package.json) 里的 `pi` manifest 发现这些资源，因此
该包能像其他包一样随 Pi 一起升级。

## 快速开始

需要一个可用的 [Pi](https://pi.dev) 安装。

```bash
pi install npm:@gavin-hu/my-pi-agent
```

[用户指南](./docs/user-guide/) 介绍其余安装方式——git、固定版本、
仅项目本地安装，以及不写入任何内容的试用——还有适用性判断、首个工作流和移除方式。

`git` 需在 `PATH` 上，供 [`worktree`](./docs/extensions/worktree.md) 与
[`rewind`](./docs/extensions/rewind.md) 使用；其余部分会优雅降级或禁用，
`/bytefly doctor` 会指出缺少什么，包括可选的运行时组件。
Windows、macOS 和 Linux 均可运行，完整检查套件在每个平台上都会执行。

然后在 Pi 中：

- `/bytefly [extension] [refresh]` 打开控制中心的 Extensions 区：三个区共用一个
  框架，头部横线的右端写着需要注意的事项（没有问题时为 `all clear`），一行 tab
  标出各区的数量与写入作用域。它按名称列出每个已加载扩展及其复选框与至多一个
  结论词，启用或禁用一个扩展，并用 `x` 清除项目级覆盖；`/` 过滤行，`!` 只保留
  需要注意的行，`?` 显示全部按键。
- `/bytefly settings` 打开控制中心的 Settings 区：一次会话会改动的十二项设置按
  Startup、Notifications、Session、Price 四组排列，值对齐在同一列；用
  `Space`/`Enter` 修改一项，用 `s` 切换 Global/Project 作用域。其余键都是
  `bytefly.json` 编辑，见配置参考。
- `/bytefly skills` 打开控制中心的 Skills 区：每个 Pi 技能一行，带启用复选框与
  至多一个结论词，`SKILL.md` 声明的描述显示在旁边的区块中，用 `Space` 在当前
  作用域开关它。
- `/bytefly doctor [extension] [refresh]` 打印 doctor 报告（`run_doctor` 的文本），
  检查每个已启用扩展在运行时是否具备所需条件。
- `/bytefly update` 立即重跑包更新检查，报告可更新的包、本包版本与 release URL，
  或跳过原因。
- `/plan <任务>` 以只读规划模式开始一个任务。
- `/skill:init` 通过内置的简短访谈和先审阅的计划创建或更新 Pi 实际读取的指令文件。

还有一件包会自行做的事：每次交互式会话启动时，`bytefly` 询问 Pi 的包管理器
哪些已配置的包有更新，抑制 Pi 自己的启动更新块，并用主题化 notice 列出它们
和 `pi update --extensions`；Pi 自身的新版本也由它绘制，提示 `pi update` 与
changelog。新版本还会标在头部 —— 本包的与 Pi 自己的。不会发送任何会话内容：
Pi 自己的版本请求只是被重新绘制，本包的最新版本则来自一次固定的 npm
`latest` 请求，`PI_OFFLINE` 可跳过检查；信任边界见
[`docs/security.md`](./docs/security.md)。

## 包含内容

21 个扩展、4 个随包技能，以及 2 个主题，按 [路线图](./ROADMAP.md) 追踪的承诺分组；
[用户指南](./docs/user-guide/) 按章节讲述同样的内容。每个扩展在 `docs/extensions/`
下的页面提供完整的工具与命令说明，并以能力表开头。

### 规划与委派

| 扩展 | 工具与命令 | 说明 |
|---|---|---|
| [`plan`](./docs/extensions/plan.md) | `enter_plan_mode`, `write_plan`, `exit_plan_mode`, `cancel_plan_mode`, `set_plan_steps`, `/plan`, `--plan` | 只读规划：模型先调研，把计划保存到 `~/.pi/agent/plans/<repo-key>` 下（每个仓库一份，各 worktree 共享），你在写入任何内容前先批准。可在 TUI 中审阅，或在浏览器中打开以留下行内评论：页面会跟随计划文件实时更新，你也可以给每位同事各一个审阅链接，各自以绑定的名义评论。`init` 技能复用同一审阅流程来创建或更新项目的 `AGENTS.md`。 |
| [`check`](./docs/extensions/check.md) | `run_check`, `/check` | 检测项目的测试、lint 或类型检查命令（或使用 `check.command`），在受监管的进程中运行，并把失败整理成可导航的 `file:line` 列表。 |
| [`subagent`](./docs/extensions/subagent.md) | `subagent`, `/agents` | 把任务委派给专职智能体（`explorer`、`planner`、`reviewer`、`worker`、`researcher`、`tester`、`debugger`、`documenter`），运行在它自己的 Pi 进程中 —— 单个、并行、链式或在后台运行；后台运行时在页脚显示数量，完成后发出提示。 |
| [`todo`](./docs/extensions/todo.md) | `todo`, `/todos` | 持久任务列表（`pending` / `in_progress` / `completed`），配一行式 widget。 |
| [`goal`](./docs/extensions/goal.md) | `goal`, `/goal` | 持久会话目标，保存在 widget 中，并在每个回合前重述。 |
| [`question`](./docs/extensions/question.md) | `ask_user_question` | 向你提出一个或多个结构化问题（带标签的选项外加自由填写的“其他”）并等待回答。 |
| [`job`](./docs/extensions/job.md) | `job`, `/jobs` | 在后台运行长时 shell 命令；查看日志、等待或结束它们。 |
| [`watch`](./docs/extensions/watch.md) | `watch`, `/watch` | 跟踪文件或命令输出，按模式匹配行，并提醒你或把匹配的行交给智能体。 |
| [`session-bus`](./docs/extensions/session-bus.md) | `session`, `/sessions`（屏幕） | 在同一仓库的多个 Pi 会话之间协调：发现彼此、交换简短消息/事件、读取收件箱、编辑前声明路径；`/sessions` 是显示对等会话、未读邮件和路径声明的实时面板。本地、默认拉取式；收件箱监视需会话自行开启，空闲时会唤起本会话的一轮，从不创建智能体。 |
| [`board`](./docs/extensions/board.md) | `board`、`/board` | 每个仓库一块共享看板：一张卡片代表一个 feature，任何 session 都可以认领、移动、编辑、加注、完成、归档——已完成的卡片会离开看板进入 `archive/`，其注记与落地 commit 仍可读，长历史不再拖累每次读取——同一个看板在浏览器里以 **Board** 和 **Team** 两个 tab 实时显示。页面只读——写入只走工具——并以固定席位 `team-lead` 对外服务，因此第二个 session 打开的是同一张页面，而不是另起一个；把卡片交给队友由 `team` 负责，因为只有它能给对端发消息。卡片可以带上优先级、声明自己在等待哪几张卡片。步骤留在 owner 的 plan 和 `todo` 里，卡片就是 feature、它的 owner，以及解释它的历史。在 `bytefly.json` 里设置 `board.port` 可以固定看板端口，收藏的地址在重启后依然有效。 |
| [`team`](./docs/extensions/team.md) | `team`、`/team` | 同一块看板上的 lead 轮次。`/team join <label>` 让一个 session 加入团队，lead 打开 `/board` 时则以 `team-lead` 自动加入；随后 `assign` 把一个 feature 交给运行中的 session，`offer` 交给谁有空谁接——广播而不写卡片，由第一个认领的人拿走——`reclaim` 把卡片收回 To do。结果会说明谁会因此被叫醒、谁会在下一轮才读到；`/team` 在终端里打印同一份轮次，不用开浏览器，也不启动任何进程。 |
| [`context`](./docs/extensions/context.md) | `/context` | 显示上下文窗口的去向 —— 系统提示、工具定义、按角色拆分的对话、注入的笔记 —— 并从报告中触发压缩，给出压缩前后的数字。 |

### 保护你的工作

| 扩展 | 工具与命令 | 说明 |
|---|---|---|
| [`worktree`](./docs/extensions/worktree.md) | `enter_worktree`, `exit_worktree`, `prune_worktrees`, `list_worktrees`, `/worktree` (screen), `/worktree enter\|exit\|prune`, `--worktree` | 在隔离的 `git worktree` 里、在独立分支上工作；内置的 read/write/edit/bash 工具会跟随，清理时也不会丢弃工作。 |
| [`rewind`](./docs/extensions/rewind.md) | `/rewind`, `/review`, `↺ N` 状态标记 | 在每次提示的首次改动前于 `refs/pi/rewind` 下对仓库生成快照，可恢复代码、对话或两者，并在还原文件前审阅本轮改动。 |
| [`memory`](./docs/extensions/memory.md) | `memory`, `/memory` | 跨会话的持久笔记，以可人工编辑的 Markdown 保存，注入每次运行，并通过 `/memory` 选择器管理。 |

### 连通外部世界

| 扩展 | 工具与命令 | 说明 |
|---|---|---|
| [`web-access`](./docs/extensions/web-access.md) | `web_search`, `web_fetch` | 搜索网络（默认无密钥的 DuckDuckGo，可选 SearXNG 或 Brave），并把页面抓取为可读文本，支持分页、`find`、逐跳 SSRF 检查、把 JSON/CSV/XML 正文渲染为表格或树状结构，以及可选的 PDF 支持。 |
| [`file-browse`](./docs/extensions/file-browse.md) | `/browse` | 启动一个以工作目录为根的本地回环、只读文件浏览器，带 Markdown 预览、模糊快速打开面板、从选区复制 `path:12-30` 引用、为常开页面提供的实时状态，以及所列目录变化时的重新加载提示。 |
| [`file-read`](./docs/extensions/file-read.md) | `read_doc` | 在进程内从本地 PDF、DOCX、DOC、ODT、RTF 或 XLSX 提取文本，支持分页。 |
| [`file-open`](./docs/extensions/file-open.md) | `/open`, `open_path` | 用操作系统原生应用打开或定位文件/目录。 |
| [`wechat`](./docs/extensions/wechat.md) | `/wechat`, `send_wechat` | 通过微信 iLink 机器人 API 把微信聊天桥接到实时会话；入站文本、图片和文件会变成回合。 |

### 界面与维护

| 扩展 | 工具与命令 | 说明 |
|---|---|---|
| [`bytefly`](./docs/extensions/bytefly.md) | `/bytefly`（`doctor`、`settings`、`skills`、`update`、`upgrade` 子命令）、`run_doctor` | 可见的那一层：主题化头部配宽度自适应页脚，Pi 工作行上实时显示工具、调用次数与计时，转录中每个工具块以调用行为标题、结果正文挂在其下方。`/bytefly` 可开关扩展与技能，并集中存放精选设置；`/bytefly upgrade` 在确认后通过 Pi 自己的包管理器安装待更新版本；可选的 `notify` 会在一次运行、后台任务或待回答的问题需要你时发出系统通知，Pi 自己的启动更新块也会变成主题化 notice 与头部标记。`bytefly.json` 是每个扩展都会读取的配置文档。 |

### 技能

按需加载的随包工作流：每个技能的名称和描述会提供给模型，只有任务匹配时才加载完整说明（`/skill:<name>` 可强制加载）。

| 技能 | 说明 |
|---|---|
| [`init`](./skills/init/SKILL.md) | 通过内置的交互式访谈和计划审阅，基于仓库证据创建或更新 Pi 实际读取的指令文件（`AGENTS.md`；存在覆盖它的 `AGENTS.override.md` 时则是该文件），并从仓库推导命令、生成路径与包范围。 |
| [`refactor`](./skills/refactor/SKILL.md) | 审计项目或路径中的重构机会：重复代码、过大的模块、耦合、结构漂移，以及测试薄弱且改动频繁的代码。随包的 `scripts/inventory.ts` 会量出体积、扇入、churn 和测试邻近度，让每条发现都带来源，排序清单附证据和验证命令；选定一个候选项后，它会把该重构带到不改行为地完成，而审计本身只读。 |
| [`project-docs`](./skills/project-docs/SKILL.md) | 让项目的四份文档如实描述代码：只读审计门面、路线图、贡献路径与 changelog，既对照代码树也互相对照；然后每个写入动作一个模式——在变更的同一次提交里记下 changelog 条目、按项目自己的规则整理发布段落、在已发布的路线图条目上删除并把其余重新编号、同步门面的目录、计数与示例。它先摸清各项目的类目名、范围拼写、条目形制与守卫，而不是套用模板；随包的 `scripts/state.ts` 会打印 changelog 的 tag、窗口与未发布类目。 |
| [`next`](./skills/next/SKILL.md) | 按优先级建议接下来的待办——未收尾的工作、已破坏或未兑现的承诺——会话已有工作时基于本次会话，仅当会话为空时才基于代码树；命令后的文字说明问什么、路径说明看哪里。只读，输出带证据和启动命令的简短编号清单。 |

### 主题

[`bytefly-dark`](./themes/bytefly-dark.json) 是 GitHub 风格的深色调色板，
[`bytefly-light`](./themes/bytefly-light.json) 是其浅色搭档，并支持可选的自动
浅色/深色切换。安装本包不会改变你的主题：通过 `/settings` → **Theme**（或
`/bytefly settings` → **Theme**）选择，
或设置 `"theme": "bytefly-light/bytefly-dark"` 以自动切换。本 README 的截图
使用 `bytefly-dark`。

### 截图

<table>
<tr>
<td width="50%"><img src="assets/screens/todo.png" alt="/todos 屏幕：Todos 标题线、3/7 完成摘要，以及带对勾、进行中和圆圈字形的列表" width="100%"></td>
<td width="50%"><img src="assets/screens/question.png" alt="ask_user_question 对话框：Auth 与 Scope 标签页、问题、四个带说明的编号选项，以及导航提示" width="100%"></td>
</tr>
<tr>
<td width="50%"><img src="assets/screens/job.png" alt="/jobs 屏幕：摘要行、带状态字形和耗时的任务行，以及焦点任务的命令、工作目录和最后一行输出" width="100%"></td>
<td width="50%"><img src="assets/screens/rewind.png" alt="/rewind 屏幕：从新到旧的提示行、标记有代码快照的菱形，以及一行标明焦点提示所持快照的详情" width="100%"></td>
</tr>
<tr>
<td width="50%"><img src="assets/screens/session.png" alt="/sessions 屏幕：计数摘要、带未读数和路径声明数的会话行、焦点会话的工作目录、声明和身份，以及 Tab 范围与监视提示" width="100%"></td>
<td width="50%"><img src="assets/screens/watch.png" alt="/watch 屏幕：摘要行和带实时匹配数的监视行，以及焦点监视的模式与来源" width="100%"></td>
</tr>
</table>

### 工具渲染

每个工具块都按转录中的样子绘制：工具自身的调用行作为标题，结果正文在其下方两列、
由转录侧栏（rail）引出
（每个工具自身的渲染器或 bytefly 的通用回退）——用户铭牌与通知、Pi 内置工具，以及本包注册的每个工具。
侧栏字形由 `chrome.rail` 设置。

![每个工具块的全页参考图：用户铭牌、通知、回合分隔线，Pi 的 read、write、edit、bash、grep、find、ls 渲染器，以及每个包内工具——todo、goal、memory、job、watch、subagent、web_search、web_fetch、read_doc、open_path、run_doctor、send_wechat、ask_user_question、session、board、team、plan 工具与 worktree 工具](assets/screens/tool-renderings.png)

`bun run screenshot:tools` 重新生成它；`bun run screenshot:tool-pngs` 在
[`assets/tools/`](./assets/tools) 下为每个工具输出一张图。

准备上手了？[用户指南](./docs/user-guide/) 为每个扩展都准备了分步讲解：
第一次运行、关键按键，以及屏幕上会出现什么。

## 配置

大多数扩展无需配置。所有扩展设置都在一个共享文档 `bytefly.json` 中，从
`<agent-dir>/bytefly.json` 读取，并与 `<cwd>/.pi/bytefly.json` 合并（项目优先），
位于一个以扩展名命名的顶层 section 下。每个扩展在 `docs/extensions/` 下的页面说明其键位的行为，
[`docs/configuration.md`](./docs/configuration.md) 则给出解析规则、设置界面操作方式，
以及每个 section 的键、类型、默认值和取值范围。

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
| [用户指南](./docs/user-guide/) | 分章手册：安装、每项功能、设置、故障排查与命令参考。 |
| [配置](./docs/configuration.md) | 解析规则、设置界面，以及 `bytefly.json` 每个键的默认值与取值范围。 |
| [架构](./docs/architecture.md) | 目标形态：加载路径、扩展契约、一次回合、状态、分层、长生命周期，以及改动应放在哪里。 |
| [扩展文档](./docs/extensions/) | 每个扩展一页，以能力表开头：工具与命令面、集成契约，以及设计说明。 |
| [开发](./docs/development.md) | 本地设置、检查、测试、跨平台注意事项与发布流程。 |
| [安全](./docs/security.md) | 回环与远程界面的信任边界。 |
| [路线图](./ROADMAP.md) | 包的下一步方向，按 README 的承诺分组，并列出每条事项的依据。 |
| [文档索引](./docs/README.md) | 全部文档的地图：各份指南，以及它们背后的深度契约，按读者归类。 |

## 参与贡献

欢迎贡献。请先阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)，了解设置、worktree
分支流程以及改动必须通过的检查。AI 编码智能体应阅读
[`AGENTS.md`](./AGENTS.md)。

## 许可证

MIT
