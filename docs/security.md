# Security

## Reporting a vulnerability

Use GitHub's private security advisories (`Security` → `Report a
vulnerability`) rather than a public issue. See [`../SECURITY.md`](../SECURITY.md)
for supported versions and scope.

## Trust boundaries

The package stays inside a Pi session, but several surfaces listen, spawn, or
read from outside it. Each one is built around an explicit boundary.

### Loopback HTTP servers

Two surfaces serve local HTTP:

- [`file-browse`](../extensions/file-browse/) binds `127.0.0.1` only, is
  read-only, and is rooted at the working directory.
- [`plan`](../extensions/plan/)'s browser review binds `127.0.0.1`, is
  tokenized, and closes its server on save, cancel, tab close, or session
  shutdown.

Neither ever binds a non-loopback interface. A remote turn (for example over
WeChat) cannot reach them; `/plan review` refuses there instead of opening a
server nobody can use.

### Worktree and shell isolation

[`worktree`](../extensions/worktree/) rebinds the session's working root and
guards against paths that escape it. The same shell-escape rule
(`lib/shell.ts`) backs [`plan`](../extensions/plan/)'s read-only git guard, so a
command that would leave the sandbox is rejected rather than run. Cleanup never
discards a worktree that still holds work.

### Read-only plan mode

[`plan`](../extensions/plan/) classifies tools with a default-deny policy
(`lib/policy.ts`) driven by the MCP `readOnlyHint`. Unknown tools are denied,
`powershell` is blocked outright, and shell access is limited to read-only git
commands. The only permitted write is the plan file itself, which can only be
created inside the plans directory and never through a symlink.

### Local file confinement

[`document`](../extensions/document/) confines `read_doc` to the effective
working directory (symlink-aware). [`file-browse`](../extensions/file-browse/)
serves only from its root. Both reuse the containment predicates in
`lib/path.ts`.

### Outbound web access

[`web-access`](../extensions/web-access/) checks every redirect hop against
private and internal address ranges before following it, so `web_fetch` cannot
be pointed at loopback, link-local, or metadata endpoints.

[`bytefly`](../extensions/bytefly/) makes one request of its own: once per
interactive session it reads npm's `latest` document for this package to tell
you a newer release exists. The request carries no session data — it is a fixed
`GET` — and `PI_OFFLINE` turns it off.

### Child processes and remote control

- [`subagent`](../extensions/subagent/) launches a child `pi` process; its
  `readOnly` mode passes only reader tools to the child.
- [`wechat`](../extensions/wechat/) admits only configured peers and keeps
  credentials under `<agent-dir>/wechat/` with mode `0600`. The `send_wechat`
  tool can message only the account owner.
- [`memory`](../extensions/memory/) injects notes into the model context; note
  text is sanitized at the boundary like any other model- or file-authored
  text.

### Model- and file-authored text

Any text that reaches a widget or the terminal passes through `sanitizeLine`
(or `stripControlChars` for multi-line text) in `lib/format.ts` first, so control
characters cannot inject terminal sequences.
