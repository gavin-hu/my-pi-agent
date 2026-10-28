# Documentation

Guides for using, configuring, and extending `@gavin-hu/my-pi-agent`. Start with
the [entry README](../README.md), then jump to the guide you need. Every feature
has its own page under [`./extensions/`](./extensions/). The deep technical
contracts live outside this directory and are linked below.

## Guides

The [entry README's Documentation table](../README.md#documentation) names every
guide with what it covers, and each feature's own page under
[`./extensions/`](./extensions/) has its keys and commands.

Exhaustive listings that a hand edit is checked against: [Configuration](./configuration.md)
carries the key list the configuration loaders are checked against, and each
extension's page carries the tool and command surface the registered extensions
are checked against.

## Deep contracts

These are the authoritative references the guides summarize:

| Document | Audience |
|---|---|
| [AGENTS.md](../AGENTS.md) | Repo invariants, the worktree branch flow, and the AI-agent workflow. |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | The contributor entry point. |
| [Extension docs](./extensions/) | One page per extension: its capabilities table, full tool surface, Pi integration, and design notes. |
| [Skills](../skills/) | The four packaged workflows, one `SKILL.md` each: when one loads, what it needs, and what it will not decide for you. |
| [lib](../lib/README.md) | Shared helpers and the host seams. |
| [lib/tui](../lib/tui/README.md) | The terminal design system: host-before-custom, block grammar, primitives, width, focus, and the render rules. |
| [Scripts](../scripts/README.md) | The dev tooling: the two capture mechanisms, fixture ownership, and when an asset is recaptured. |
| [test](../test/README.md) | Test principles, tiers, and helper conventions. |
| [Changelog](../CHANGELOG.md) | Release notes. |
