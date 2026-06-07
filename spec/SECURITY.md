# Security Policy

agent-tripwire is a security tool. We take security in our own supply chain and codebase seriously.

## Reporting a vulnerability

If you have found a vulnerability in tripwire itself — for example:

- A way to evade detection (process-tree manipulation, race conditions in the watcher, classifier bypass).
- A way to exploit the daemon via malformed input (crafted filesystem events, IoC payloads, dashboard requests).
- A way to escalate privileges via the daemon, the fanotify helper binary, or the IoC feed pipeline.
- A way to poison the IoC feed or rule pack distribution.
- A way to exfiltrate user data via the dashboard or community feed plumbing.

**Please do not open a public issue.** Use GitHub's [private vulnerability reporting](https://github.com/jmaleonard/agent-tripwire/security/advisories/new) (the "Report a vulnerability" button on the repo's Security tab) and include:

- A description of the issue and its impact.
- Steps to reproduce, or a proof-of-concept.
- Your name and how you'd like to be credited (optional).

We will:

- Acknowledge receipt within 72 hours.
- Triage and respond with a remediation plan within 7 days for high-severity issues.
- Coordinate a disclosure timeline with you, defaulting to public disclosure 90 days after report or upon fix release, whichever is sooner.

For especially sensitive reports, request our PGP key in the private advisory thread and we will share it for follow-up.

## Scope

In scope:

- The tripwire `tripwired` daemon and `tripwire` user CLI.
- The filesystem watcher (fanotify helper + fsevents subsystem).
- The process tree walker and agent classifier.
- The detection engine, allowlist, snooze, and IoC enrichment.
- The notification subsystem.
- The IoC seeder and bundled feed integrations.
- The local dashboard.
- The community IoC feed infrastructure (`feed.tripwire.jmaleonard.dev`), including the re-verification worker and its sandbox.
- The release distribution pipeline (`jmaleonard.github.io/agent-tripwire`, signed manifests, npm package).
- The bundled rule pack, IoC snapshot, and default allowlist.

Out of scope:

- Vulnerabilities in third-party feeds we consume (report those to the feed maintainer; OSV, GitHub Advisory, Aikido).
- Vulnerabilities in operating-system primitives (fanotify, fsevents, libnotify, launchd, systemd).
- Vulnerabilities in npm/pnpm/yarn/pip/uv themselves. (We don't wrap them; we watch what their installed packages do at runtime.)
- Vulnerabilities in install-time tools like Aikido Safe Chain or Socket Firewall.
- Social engineering of project maintainers.
- Denial of service against unauthenticated endpoints by sustained traffic.

## Our own supply chain

We try to practice what we preach. Specifically:

- The tripwire npm package is published with **provenance** via GitHub Actions OIDC.
- Release tarballs are signed with **Sigstore** and verified by the one-shot installer.
- The repo enforces required reviews on protected branches, signed commits for maintainers, and protected `main`.
- Dependencies are pinned with lockfiles and reviewed on update. We minimize the transitive footprint deliberately — every dependency is itself a supply-chain risk.
- The one-shot installer is reproducible: a fresh checkout at a tag produces a byte-identical installer script.

## Trust model — what tripwire promises and doesn't

Tripwire is a **detection-only notifier**. It tells you what happened. It does not prevent it. The trust model is correspondingly narrow.

**Tripwire commits to:**

- Telling you when a watched sensitive path was read or written by a process not on your allowlist (within the platform-coverage caveats below).
- Attributing that event to a process and its ancestry, including agent / package-manager classification.
- Enriching the event with IoC attribution if the responsible package is on a known-bad list.
- Logging every event to a local SQLite store regardless of snooze state.
- Not silencing dashboard logs under any snooze condition.
- Not transmitting any data off the machine unless you have explicitly opted in to the community feed, in which case only the package-centric payload described in [docs/community-feed.md](./docs/community-feed.md) is sent.

**Tripwire does NOT commit to:**

- **Preventing the file access that triggered the event.** The read has already happened by the time you see the notification. If you need pre-event blocking, run an install-time blocker (Aikido Safe Chain, Socket Firewall) alongside.
- **Catching every malicious read.** A determined attacker can avoid watched paths, race the daemon, or run a kernel rootkit.
- **Read coverage on macOS.** Apple's Endpoint Security entitlement is required for read events, and we don't have it. We watch writes faithfully and infer reads via process behavior; this is documented as a known gap, not papered over.
- **Catching activity that runs before the daemon starts** (e.g., during boot, or before `tripwire setup` completed).
- **Catching activity from compromised, signed system binaries** (the OS vendor's problem).
- **Catching activity from a compromise of tripwire's own distribution channel.** (We harden against this with Sigstore signatures and provenance, but the residual risk is real.)
- **Stopping a hostile root user.** If they have root, they can disable the daemon, alter the event store, or replace the binary.

We document this honestly because users layer tools based on threat-model awareness. Confused trust is worse than no trust.

## Coordinated disclosure of malicious packages

If you have discovered a malicious package in the npm/PyPI ecosystem (not a vulnerability in tripwire), the right venues are:

- **npm**: https://www.npmjs.com/support (use the "report malware" path).
- **PyPI**: security@pypi.org.
- **OSV**: report via https://osv.dev/contribute.
- **GitHub Advisory DB**: https://github.com/github/advisory-database.
- **Aikido**: their public reporting channel.

You may *also* submit to tripwire's community feed (see [docs/community-feed.md](./docs/community-feed.md)) once the package has been reported to the registry. We will not be the first venue to disclose an active campaign — that risks tipping off attackers before the registry can act.

## Hall of fame

Researchers who have responsibly disclosed issues will be acknowledged here (with consent).
