# Documentation

Guides for using, configuring, and extending `@gavin-hu/my-pi-agent`. Start with
[Getting started](./getting-started.md), then jump to the guide you need. The
deep technical contracts live outside this directory and are linked below.

## Guides

| Guide | What it covers |
|---|---|
| [Getting started](./getting-started.md) | Whether the pack fits, a trial run, install options, verifying the load, first workflows, turning parts off, and removal. |
| [User guide](./user-guide.md) | Every feature explained for people who use Pi rather than work on it: an overview of each, then a numbered walkthrough with the keys and commands. |
| [Extensions](./extensions.md) | The full catalog of every extension and theme, with its tools and commands. |
| [Configuration](./configuration.md) | Config-file resolution, the per-extension index, and environment variables. |
| [Configuration reference](./references/bytefly-config.md) | Every `bytefly.json` section and key, with its type, default, and bounds. |
| [Architecture](./architecture.md) | How the package, its extensions, and `lib/` fit together. |
| [Development](./development.md) | Local setup, checks, tests, cross-platform notes, and the release process. |
| [Security](./security.md) | Trust boundaries for the loopback and remote surfaces. |
| [Roadmap](../ROADMAP.md) | Where the pack is going, grouped by the README's promises, with the evidence behind each item. |

Exhaustive listings that a hand edit is checked against live in
[`references/`](./references/); the guides link to them instead of restating
them.

## Deep contracts

These are the authoritative references the guides summarize:

| Document | Audience |
|---|---|
| [`../AGENTS.md`](../AGENTS.md) | Repo invariants, the worktree branch flow, and the AI-agent workflow. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | The contributor entry point. |
| [`../extensions/<name>/README.md`](../extensions/) | One doc per extension: full tool surface, Pi integration, and design notes. |
| [`../lib/README.md`](../lib/README.md) | Shared helpers and the host seams. |
| [`../lib/tui/README.md`](../lib/tui/README.md) | The terminal design system: host-before-custom, block grammar, primitives, width, focus, and the render rules. |
| [`../test/README.md`](../test/README.md) | Test principles, tiers, and helper conventions. |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Release notes. |
