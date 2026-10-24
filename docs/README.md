# Documentation

Guides for using, configuring, and extending `@gavin-hu/my-pi-agent`. Start with
the [User guide](./user-guide/), then jump to the guide you need. The deep
technical contracts live outside this directory and are linked below.

## Guides

The [entry README's Documentation table](../README.md#documentation) summarises
each of these; this is the same set, by name.

- [User guide](./user-guide/)
- [Configuration](./configuration.md)
- [Architecture](./architecture.md)
- [Development](./development.md)
- [Security](./security.md)
- [Roadmap](../ROADMAP.md)

Exhaustive listings that a hand edit is checked against live beside the guide
that explains them; [Configuration](./configuration.md) carries the key list the
configuration loaders are checked against.

## Deep contracts

These are the authoritative references the guides summarize:

| Document | Audience |
|---|---|
| [`../AGENTS.md`](../AGENTS.md) | Repo invariants, the worktree branch flow, and the AI-agent workflow. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | The contributor entry point. |
| [`./extensions/<name>.md`](./extensions/) | One page per extension: its capabilities table, full tool surface, Pi integration, and design notes. |
| [`../lib/README.md`](../lib/README.md) | Shared helpers and the host seams. |
| [`../lib/tui/README.md`](../lib/tui/README.md) | The terminal design system: host-before-custom, block grammar, primitives, width, focus, and the render rules. |
| [`../test/README.md`](../test/README.md) | Test principles, tiers, and helper conventions. |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Release notes. |
