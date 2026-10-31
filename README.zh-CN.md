# my-pi-agent

[English](./README.md) · **简体中文**

[![CI](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/gavin-hu/my-pi-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40gavin-hu%2Fmy-pi-agent)](https://www.npmjs.com/package/@gavin-hu/my-pi-agent)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![built for Pi](https://img.shields.io/badge/built%20for-Pi-5A4FCF)](https://pi.dev)

`my-pi-agent` 是一个 [Pi](https://pi.dev) 包，在你已经使用的智能体之上新增一组精选
扩展、技能和主题 —— 安装整个包，关掉你不需要的部分，其余照常使用 Pi。

本页是目录与安装说明。每个功能在 [`docs/extensions/`](./docs/extensions/) 下都有自己的页面，
写清按键、命令以及应有的效果。

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
pi install npm:@gavin-hu/my-pi-agent                        # 最新发布版
pi install git:github.com/gavin-hu/my-pi-agent@v0.22.0      # 固定版本
```

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
- `/bytefly settings` 打开控制中心的 Settings 区：一次会话会改动的十五项设置按
  Startup、Notifications、Session、Board、Price 五组排列，值对齐在同一列；用
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

22 个扩展、3 个随包技能，以及 2 个主题，按本 README 的承诺分组。
每个扩展在 `docs/extensions/` 下的页面提供完整的工具与命令说明，并以能力表开头。

### 规划与委派

| 扩展 | 工具与命令 | 说明 |
|---|---|---|
| [`plan`](./docs/extensions/plan.md) | `plan`, `/plan`, `--plan` | 只读规划（一个工具五个动作：`enter`、`write`、`exit`、`steps`、`cancel`）：模型先调研，把计划保存到 `~/.pi/agent/plans/<repo-key>` 下（每个仓库一份，各 worktree 共享），你在写入任何内容前先批准。可在 TUI 中审阅，或在浏览器中打开以留下行内评论：页面会跟随计划文件实时更新，你也可以给每位同事各一个审阅链接，各自以绑定的名义评论。`init` 技能复用同一审阅流程来创建或更新项目的 `AGENTS.md`。 |
| [`check`](./docs/extensions/check.md) | `run_check`, `/check` | 检测项目的测试、lint 或类型检查命令（或使用 `check.command`），在受监管的进程中运行，并把失败整理成可导航的 `file:line` 列表。 |
| [`subagent`](./docs/extensions/subagent.md) | `subagent`, `/agents` | 把任务委派给专职智能体（`explorer`、`planner`、`reviewer`、`worker`、`researcher`、`tester`、`debugger`、`documenter`），运行在它自己的 Pi 进程中 —— 单个、并行、链式或在后台运行；后台运行时在页脚显示数量，完成后发出提示。 |
| [`todo`](./docs/extensions/todo.md) | `todo`, `/todos` | 持久任务列表（`pending` / `in_progress` / `completed`），配一行式 widget。 |
| [`goal`](./docs/extensions/goal.md) | `goal`, `/goal` | 持久会话目标，保存在 widget 中，并在每个回合前重述。 |
| [`question`](./docs/extensions/question.md) | `ask_user_question` | 向你提出一个或多个结构化问题（带标签的选项外加自由填写的“其他”）并等待回答。 |
| [`job`](./docs/extensions/job.md) | `job`, `/jobs` | 在后台运行长时 shell 命令；查看日志、等待或结束它们。 |
| [`watch`](./docs/extensions/watch.md) | `watch`, `/watch` | 跟踪文件或命令输出，按模式匹配行，并提醒你或把匹配的行交给智能体。 |
| [`session-bus`](./docs/extensions/session-bus.md) | `session`, `/sessions`（屏幕） | 在同一仓库的多个 Pi 会话之间协调：发现彼此、交换简短消息/事件、读取收件箱、编辑前声明路径；`/sessions` 是显示对等会话、未读邮件和路径声明的实时面板。本地、默认拉取式；收件箱监视需会话自行开启，空闲时会唤起本会话的一轮，从不创建智能体。 |
| [`serve`](./docs/extensions/serve.md) | — | 每个 session 一个 loopback 服务。`/board`、`/browse` 和浏览器里的 plan review 都在它上面挂载路径前缀，而不是各自监听端口，因此一个 session 只有一个端口、一个 chip、一条关闭路径——而第二个 session（peer 会话、另一个 worktree、另一个 Pi）依然有自己的端口。端口由仓库自身的 key 哈希到 `4780`–`5779`，每个项目各有自己的编号，因此收藏的地址在重启后依然有效、无需任何设置；`bytefly.json` 里的 `serve.port` 可以覆盖它；共享 review 只为发起共享的那一个页面借用同一个网段上的一个地址。 |
| [`board`](./docs/extensions/board.md) | `board`、`/board` | 每个仓库一块共享看板：一张卡片代表一个 feature，在五条车道间移动——`backlog`、`plan`、`execute`、`blocked`、`done`——契约（`goal`、`acceptance`、`scopeOut`）必须写明，并指向 `plan` 的 `write` 动作存进本仓库 plan store 的那份 plan 文件，由 lead（`bytefly.json` 里的 `board.lead`，且不能是卡片持有者）或本人用 `/board approve` 批准——之后才能进入执行，完成的工作同样要经过 `/board review` 抽检才能收尾；`plan` 与 `execute` 受 `bytefly.json` 里的 WIP 上限约束。已完成的卡片会离开看板进入 `archive/`，其注记与落地 commit 仍可读；同一个看板在浏览器里以 **Board** 和 **Team** 两个 tab 实时显示。页面只读——写入只走工具——以看板 lead（`board.lead`，默认 `lead`）的席位对外服务，因此第二个 session 打开的是同一张页面；把卡片交给队友由 `team` 负责——看板自己只发一条消息，即签名后告知卡片的 owner，好让能走下一步的 session 被通知，而不是轮询。卡片可以带上优先级、声明自己在等待哪几张卡片。步骤留在 owner 的 plan 和 `todo` 里，卡片就是 feature、它的 owner，以及解释它的历史。Team tab 会把 bus 没有记录的 owner 收成一行，因为只要某张卡片曾归属它，它就会一直是 owner。页面以 `/board` 挂在该项目自身的端口上（由仓库 key 哈希得到），因此收藏的地址重启后依然有效、无需设置；`bytefly.json` 里的 `serve.port` 可以覆盖它。默认关闭：用 `PI_ENABLED_EXTENSIONS=board` 加载。 |
| [`team`](./docs/extensions/team.md) | `team`、`/team` | 同一块看板上的 lead 轮次。`/team join <label>` 让一个 session 加入团队，lead 打开 `/board` 时则以页面席位之名自动加入；随后 `assign` 把一个 feature 交给运行中的 session，`offer` 交给谁有空谁接——广播而不写卡片，由第一个认领的人拿走——`reclaim` 把卡片收回 Backlog，`claim` 则让 lead 自己接手，之后的 plan 与 contract 交给 `board`。结果会说明谁会因此被叫醒、谁会在下一轮才读到；`/team` 在终端里打印同一份轮次，不用开浏览器，也不启动任何进程。与 `board` 一并默认关闭：用 `PI_ENABLED_EXTENSIONS=board,team` 加载。 |
| [`context`](./docs/extensions/context.md) | `/context` | 显示上下文窗口的去向 —— 系统提示、工具定义、按角色拆分的对话、注入的笔记 —— 并从报告中触发压缩，给出压缩前后的数字。 |

### 保护你的工作

| 扩展 | 工具与命令 | 说明 |
|---|---|---|
| [`worktree`](./docs/extensions/worktree.md) | `worktree`, `/worktree` (screen), `/worktree enter\|exit\|prune`, `--worktree` | 在隔离的 `git worktree` 里、在独立分支上工作（一个工具四个动作：`enter`、`exit`、`list`、`prune`）；内置的 read/write/edit/bash 工具会跟随，清理时也不会丢弃工作。 |
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
| [`bytefly`](./docs/extensions/bytefly.md) | `/bytefly`（`doctor`、`settings`、`skills`、`update`、`upgrade` 子命令）、`run_doctor` | 可见的那一层：主题化头部配宽度自适应页脚，输入框上边框实时显示 `working` 计数、本次运行的工具数与计时，转录中每个工具块以调用行为标题、结果正文挂在其下方。`/bytefly` 可开关扩展与技能，并集中存放精选设置；`/bytefly upgrade` 在确认后通过 Pi 自己的包管理器安装待更新版本；可选的 `notify` 会在一次运行、后台任务或待回答的问题需要你时发出系统通知，Pi 自己的启动更新块也会变成主题化 notice 与头部标记。`bytefly.json` 是每个扩展都会读取的配置文档。 |

### 技能

按需加载的随包工作流：每个技能的名称和描述会提供给模型，只有任务匹配时才加载完整说明（`/skill:<name>` 可强制加载）。

| 技能 | 说明 |
|---|---|
| [`init`](./skills/init/SKILL.md) | 通过内置的交互式访谈和计划审阅，基于仓库证据创建或更新 Pi 实际读取的指令文件（`AGENTS.md`；存在覆盖它的 `AGENTS.override.md` 时则是该文件），并从仓库推导命令、生成路径与包范围。 |
| [`refactor`](./skills/refactor/SKILL.md) | 审计项目或路径中的重构机会：重复代码、过大的模块、耦合、结构漂移，以及测试薄弱且改动频繁的代码。随包的 `scripts/inventory.ts` 会量出体积、扇入、churn 和测试邻近度，让每条发现都带来源，排序清单附证据和验证命令；选定一个候选项后，它会把该重构带到不改行为地完成，而审计本身只读。 |
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

下面是终端里画出的计划审查，以及本包在浏览器中提供的三个页面：看板、浏览器版计划审查和文件浏览器。

![终端计划审查：Plan Review 标题线、一条说明自上次审查以来有一节已改动的通知、带标题与 ◼/◻ 任务复选框的计划正文、标出当前章节和可见行范围的滚动指示线，以及 Esc/a/r/w、滚动与章节跳转提示](assets/screens/plan.png)

![看板页：带仓库名与实时徽标的工具栏、Board 与 Team 两个标签页、完成数/总数进度、过滤器、按键按钮和主题切换；五个泳道托盘，各带一个点、一个计数和一个折叠控件；卡片带负责人标签、笔记数及其时长、路径提示，以及一行理由，写着它在等什么、它卡住了哪些卡，卡片上没有任何按钮](assets/screens/board.png)

![浏览器版计划审查：粘性头部带计划标题、状态标签，以及 Approve & run、Save feedback、Back to Pi 三个动作和一个 Share 动作；侧栏带步骤进度与章节大纲；计划本身是一列有度量宽度的正文，注释栏里放着负责人自己的评论和队友 @priya 的评论](assets/screens/plan-review.png)

![回环文件浏览器：路径过滤器、文件树，以及渲染好的 Markdown 预览](assets/screens/file-browse.png)

### 工具渲染

每个工具块都按转录中的样子绘制：工具自身的调用行作为标题，结果正文在其下方两列、
由转录侧栏（rail）引出
（每个工具自身的渲染器或 bytefly 的通用回退）——用户铭牌与通知、Pi 内置工具，以及本包注册的每个工具。
侧栏字形由 `chrome.rail` 设置。

<img src="assets/screens/tool-renderings.png" alt="每个工具块的全页参考图：用户铭牌、通知、回合分隔线，Pi 的 read、write、edit、bash、grep、find、ls 渲染器，以及每个包内工具——todo、goal、memory、job、watch、subagent、web_search、web_fetch、read_doc、open_path、run_doctor、send_wechat、ask_user_question、session、board、team、plan 工具与 worktree 工具" width="100%">

`bun run screenshot:tools` 重新生成它；`bun run screenshot:tool-pngs` 在
[`assets/tools/`](./assets/tools) 下为每个工具输出一张图。

准备上手了？每个扩展在 [`docs/extensions/`](./docs/extensions/) 下的页面开头便说明它做什么，
以及它对应的按键与命令。

## 配置

大多数扩展无需配置。所有扩展设置都在一个共享文档 `bytefly.json` 中，从
`<agent-dir>/bytefly.json` 读取，并与 `<cwd>/.pi/bytefly.json` 合并（项目优先），
位于一个以扩展名命名的顶层 section 下。每个扩展在 `docs/extensions/` 下的页面说明其键位的行为，
[`docs/configuration.md`](./docs/configuration.md) 则给出解析规则、设置界面操作方式，
以及每个 section 的键、类型、默认值和取值范围。

几乎所有扩展默认都开启。例外是 `board` 与 `team`：看板和它的 lead 那一半是同一个
工作流，session 要么在做，要么不做；从不处理看板的 session 不该背着这些工具、命令和页面。
把 opt-in 扩展名写进 `PI_ENABLED_EXTENSIONS` 就会加载：

```bash
PI_ENABLED_EXTENSIONS=board,team pi -e .
```

若要在加载整包时排除一些默认开启的扩展，把 `PI_DISABLED_EXTENSIONS`
设为一个以逗号或空白分隔的扩展名列表（即 [`extensions/`](./extensions/) 下的目录
名）：

```bash
PI_DISABLED_EXTENSIONS=todo,job pi -e .
```

名称比较不区分大小写，未知名称会被忽略。`PI_ENABLED_EXTENSIONS` 只负责打开 opt-in
扩展，写在这里的名字不会关掉别的扩展；而 `PI_DISABLED_EXTENSIONS` 仍然优先于它。
两者都只会阻止工厂注册；若要移除整包，请使用 Pi 的 `--no-extensions`，或从你的设置中
删除该包。

## 文档

| 指南 | 内容 |
|---|---|
| [配置](./docs/configuration.md) | 解析规则、设置界面，以及 `bytefly.json` 每个键的默认值与取值范围。 |
| [架构](./docs/architecture.md) | 目标形态：加载路径、扩展契约、一次回合、状态、分层、长生命周期，以及改动应放在哪里。 |
| [扩展文档](./docs/extensions/) | 每个扩展一页，以能力表开头：工具与命令面、集成契约，以及设计说明。 |
| [开发](./docs/development.md) | 本地设置、检查、测试、跨平台注意事项与发布流程。 |
| [安全](./docs/security.md) | 回环与远程界面的信任边界。 |
| [文档索引](./docs/README.md) | 全部文档的地图：各份指南，以及它们背后的深度契约，按读者归类。 |

## 参与贡献

欢迎贡献。请先阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)，了解设置、worktree
分支流程以及改动必须通过的检查。AI 编码智能体应阅读
[`AGENTS.md`](./AGENTS.md)。

## 许可证

MIT
