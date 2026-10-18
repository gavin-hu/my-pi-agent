# Documentation

Guides for using, configuring, and extending `@gavin-hu/my-pi-agent`. Start with
[Getting started](./getting-started.md), then jump to the guide you need. The
deep technical contracts live outside this directory and are linked below.

## Guides

| Guide | What it covers |
|---|---|
| [Getting started](./getting-started.md) | Requirements, install options, verifying the load, themes, disabling extensions. |
| [Extensions](./extensions.md) | The full catalog of every extension and theme, with its tools and commands. |
| [Configuration](./configuration.md) | Config-file resolution, the per-extension index, and environment variables. |
| [Configuration reference](./configuration-reference.md) | Every `bytefly.json` section and key, with its type, default, and bounds. |
| [Architecture](./architecture.md) | How the package, its extensions, and `lib/` fit together. |
| [Development](./development.md) | Local setup, checks, tests, cross-platform notes, and the release process. |
| [Security](./security.md) | Trust boundaries for the loopback and remote surfaces. |

## Deep contracts

These are the authoritative references the guides summarize:

| Document | Audience |
|---|---|
| [`../AGENTS.md`](../AGENTS.md) | Repo invariants, the worktree branch flow, and the AI-agent workflow. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | The contributor entry point. |
| [`../extensions/<name>/README.md`](../extensions/) | One doc per extension: full tool surface, Pi integration, and design notes. |
| [`../lib/README.md`](../lib/README.md) | Shared helpers and the host seams. |
| [`../test/README.md`](../test/README.md) | Test principles, tiers, and helper conventions. |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Release notes. |
