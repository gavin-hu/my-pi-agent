# Documentation

Guides for using, configuring, and extending `@gavin-hu/my-pi-agent`. Start with
the [User guide](./user-guide/), then jump to the guide you need. The deep
technical contracts live outside this directory and are linked below.

## Guides

The [entry README's Documentation table](../README.md#documentation) names every
guide with what it covers; read the [User guide](./user-guide/) first, then the
guide for what you are doing.

Exhaustive listings that a hand edit is checked against live beside the guide
that explains them: [Configuration](./configuration.md) carries the key list the
configuration loaders are checked against, and the user guide's
[reference](./user-guide/reference.md) carries the command list the registered
commands are checked against.

## Deep contracts

These are the authoritative references the guides summarize:

| Document | Audience |
|---|---|
| [AGENTS.md](../AGENTS.md) | Repo invariants, the worktree branch flow, and the AI-agent workflow. |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | The contributor entry point. |
| [Extension docs](./extensions/) | One page per extension: its capabilities table, full tool surface, Pi integration, and design notes. |
| [Skills](../skills/) | The five packaged workflows, one `SKILL.md` each: when one loads, what it needs, and what it will not decide for you. |
| [lib](../lib/README.md) | Shared helpers and the host seams. |
| [lib/tui](../lib/tui/README.md) | The terminal design system: host-before-custom, block grammar, primitives, width, focus, and the render rules. |
| [Scripts](../scripts/README.md) | The dev tooling: the two capture mechanisms, fixture ownership, and when an asset is recaptured. |
| [test](../test/README.md) | Test principles, tiers, and helper conventions. |
| [Changelog](../CHANGELOG.md) | Release notes. |
