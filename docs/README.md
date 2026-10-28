# Documentation

Guides for using, configuring, and extending `@gavin-hu/my-pi-agent`: the
[entry README's Documentation table](../README.md#documentation) names each one with what it
covers, and every feature has its own page under [`./extensions/`](./extensions/) carrying its
tool and command surface — the same way [Configuration](./configuration.md) carries the key list
the configuration loaders are checked against. This page is the map of the **contracts** behind
them, the references a page is checked against rather than prose to read first.

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
