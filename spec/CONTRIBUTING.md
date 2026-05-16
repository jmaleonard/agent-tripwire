# Contributing to agent-tripwire

Thanks for considering a contribution. This project exists because the npm and PyPI ecosystems are under sustained attack and the *runtime visibility* piece is still missing from the ecosystem. Every rule, IoC source, agent-runtime definition, and false-positive trim helps.

## Quick start

```bash
git clone https://github.com/dawnika/agent-tripwire.git
cd agent-tripwire
pnpm install
pnpm build
pnpm test
```

Requirements:

- Node ≥ 22 LTS
- pnpm ≥ 9
- macOS or Linux
- (Linux only) `libfanotify`-capable kernel, plus a build toolchain if you're working on the helper binary.

## Project layout

The monorepo is organized as pnpm workspaces. See [agent-tripwire-spec.md §6.2](./agent-tripwire-spec.md) for the full tree. Key packages:

| Package | Purpose |
|---------|---------|
| `packages/cli` | User-facing `tripwire` CLI (setup, doctor, snooze, allowlist, status). **Not package-manager shims.** |
| `packages/watcher` | Filesystem watcher (`fanotify` on Linux, `fsevents` on macOS). |
| `packages/identity` | Process tree walker + agent / package-manager classifier. |
| `packages/engine` | Rule evaluation, allowlist match, snooze check, IoC enrichment. |
| `packages/notifier` | Native OS notification surfaces. |
| `packages/snooze` | Snooze state + duration management. |
| `packages/feeds` | IoC seeder (Phase 0). |
| `packages/rules` | YAML rule definitions + bundled IoC snapshot + default allowlist. |
| `packages/store` | SQLite event store. |
| `packages/dashboard` | Local web UI. |
| `packages/shared` | Cross-package types and utilities. |

Each package builds independently. Most changes touch one or two.

## Development workflow

```bash
# Run all tests
pnpm test

# Run tests for a single package
pnpm --filter @tripwire/engine test

# Watch mode while developing
pnpm --filter @tripwire/engine test --watch

# Lint and typecheck
pnpm lint
pnpm typecheck

# Build everything
pnpm build

# Run the daemon from source
pnpm tripwired

# Run the CLI from source
pnpm tripwire -- status
```

## Pull requests

- Keep PRs small. Aim for under 800 lines of diff. Split bigger features.
- Every PR ships with tests.
- Update the relevant docs in the same PR. README, INSTALL, and docs/rules.md are part of the product.
- Conventional commits in the title (`feat:`, `fix:`, `docs:`, `chore:`).
- CI must pass: tests on Ubuntu 22.04 + macOS 14, Node 22 + 24.

## Adding a rule for a new sensitive path

Most contributions will be "watch path X for event Y from category Z." Concrete steps:

1. **Add the path** to `watcher.watch_reads` or `watcher.watch_writes` in `packages/rules/default-config.yaml`.
2. **Add a rule** under `packages/rules/patterns/` scoped by `path` + `event_kind` + `ancestry_category`. See [docs/rules.md](./docs/rules.md) for the schema.
3. **Add an entry** in `packages/rules/default-allowlist.yaml` for any **expected** legitimate access (e.g., the canonical CLI that reads that path).
4. **Add fixtures**: a positive (an unexpected process reading the path) and a negative (the canonical process reading the path) under `test/fixtures/rules/<rule-id>/`.
5. **Add the path** to the false-positive corpus' "normal workflows" list so future contributors don't regress your tuning.
6. **Run `pnpm test:rules`** and `pnpm test:false-positive-corpus --rule <id>`.

If the rule is based on a real-world attack, link a public writeup in the rule's `references` field. We do not accept rules sourced from non-public threat intel — every detection must be reproducible from public information.

## Adding an agent runtime to the identity detector

The identity classifier learns about agent runtimes from `packages/identity/agents.yaml`. To add one:

1. Add an entry:

```yaml
- name: aider
  env_marker: AIDER_SESSION                 # exported by the agent runtime
  default_category: agent-direct            # what to label the agent process itself
  exe_globs:                                # fallback: match by binary path
    - "**/aider"
    - "${HOME}/.local/share/aider/bin/aider"
```

2. Add ancestry fixtures under `test/fixtures/ancestry/aider/` showing both env-marked and path-matched detection.
3. Update the documented cooperation ask in the README (the list of "agents we ask to export identity env vars") if this runtime doesn't yet cooperate.

The env-var path is preferred — it's robust against renames and version-manager wrappers. The exe-globs path is a fallback we maintain reluctantly: it breaks when the binary is relocated, renamed, or wrapped (Volta, nvm, asdf, etc.).

## Adding an IoC feed source

Feed fetchers live in `packages/feeds/src/`. Each implements a small interface:

```typescript
export interface FeedSource {
  id: string;
  refresh(opts: RefreshOptions): AsyncIterable<IoCEntry>;
  healthCheck(): Promise<FeedHealth>;
}
```

When adding a feed:

- Stub HTTP with `nock` or recorded fixtures for tests.
- Document rate limits, auth requirements, and ToS in the file header.
- Add the source to the merger and to `tripwire feeds status` output.
- Add attribution requirements to the README if the source's license requires it.

## Tuning the default allowlist (highest-leverage contribution)

The bundled default allowlist is the single biggest determinant of whether tripwire is useful out of the box. Too tight, and normal workstation activity floods the user with false positives and they uninstall. Too loose, and real attacks slip past.

Concrete ways to help:

- **Run tripwire on your own workstation for a week.** Take note of every event in the dashboard that's clearly normal-behavior. Open a PR adding those `(rule, ancestry)` pairs to `packages/rules/default-allowlist.yaml`, with reasoning.
- **Reproduce a normal workflow** not in our corpus (a less-common editor, a specific build tool, a specific cloud SDK), capture the events, and add the workflow to `test/fixtures/allowlist-corpus/` so CI keeps it covered going forward.
- **Audit existing allowlist entries** against changing ecosystem behavior — every quarter or so, an entry becomes wrong (a tool changed where it stores credentials, an agent runtime changed how it spawns subprocesses).

These contributions don't need to be big to be valuable. Even one PR adding one workflow is meaningful.

## Security disclosures

If you find a vulnerability in tripwire itself — an evasion technique, a way to exploit the daemon via crafted process trees or IoC payloads, a way to exfiltrate user data via the dashboard or community feed plumbing — please **do not open a public issue**. See [SECURITY.md](./SECURITY.md).

## Community feed contributions

If you've spotted a malicious package's runtime behavior in the wild and want to contribute the IoC to the community feed, see [docs/community-feed.md](./docs/community-feed.md). The submission process is designed so that any submission can be independently re-verified from the public package tarball — we don't accept un-reproducible reports.

## License

By contributing, you agree your contributions are licensed under the project's license (TBD; expected Apache-2.0 or MIT).

## Code of conduct

Be kind. Assume good faith. The maintainers reserve the right to remove contributors who harass others or who use this project's infrastructure to attack people.
