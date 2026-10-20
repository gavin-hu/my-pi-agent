# Documentation

Guides for using, configuring, and extending `@gavin-hu/my-pi-agent`. Start with
the [User guide](./user-guide.md), then jump to the guide you need. The deep
technical contracts live outside this directory and are linked below.

## Guides

| Guide | What it covers |
|---|---|
| [User guide](./user-guide.md) | Every feature explained for people who use Pi rather than work on it: an overview of each, then a numbered walkthrough with the keys and commands. |
| [Configuration](./configuration.md) | Resolution rules, the settings screen, every section and key, and the environment variables. |
| [Architecture](./architecture.md) | The load path, runtime model, state, process shapes, and where new code belongs. |
| [Development](./development.md) | Local setup, checks, tests, cross-platform notes, and the release process. |
| [Security](./security.md) | Trust boundaries for the loopback and remote surfaces. |
| [Roadmap](../ROADMAP.md) | Where the pack is going, grouped by the README's promises, with the evidence behind each item. |

Exhaustive listings that a hand edit is checked against live beside the guide
that explains them; [Configuration](./configuration.md) carries the key list the
configuration loaders are checked against.

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
