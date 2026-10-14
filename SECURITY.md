# Security Policy

## Supported versions

Only the latest tagged release is supported. Please reproduce a report against
the newest `vX.Y.Z` tag before filing it.

## Reporting a vulnerability

Use GitHub's private security advisories: open the repository's **Security**
tab and choose **Report a vulnerability**. Do not open a public issue for a
security problem.

Please include the affected extension or surface, the package version, your OS,
reproduction steps, and the impact you believe it has.

## Scope

This package runs inside a [Pi](https://pi.dev) session. In scope are the
surfaces this package adds:

- The loopback HTTP servers in `file-browse` and `plan`'s browser review.
- The `worktree` isolation guard and the shared shell-escape rule.
- The read-only policy behind `plan` mode.
- The path confinement in `document` and `file-browse`.
- The per-hop SSRF checks in `web-access`.
- The `subagent` child process and its `readOnly` tool set.
- The `wechat` bridge and its stored credentials.

Out of scope: vulnerabilities in Pi itself or in third-party dependencies
(report those upstream), and issues that require an already-compromised local
account or terminal.

See [`docs/security.md`](./docs/security.md) for the trust boundaries and how
each one is mitigated.
