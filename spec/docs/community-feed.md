# Community IoC Feed — Specification

**Status:** Draft v0.2 — runtime-observed framing, 2026-05-16
**Companion to:** `agent-tripwire-spec.md`
**Audience:** Claude Code (build), Jared Leonard (operate), users (decide whether to opt in)

---

## 1. Purpose

The bundled IoC feeds (Aikido, OSV, GitHub Advisory) are excellent for install-time blockers, but they describe *which packages* are bad, not *what those packages actually do at runtime*. They also lag the threat: advisories are typically published hours to days after a compromised package goes live.

A community feed — sourced from tripwire installations that opt in to contribute — can close a different gap: **runtime-observed IoCs.** When tripwire fires a runtime rule (a package's subprocess reads `~/.aws/credentials`, a postinstall writes `.claude/settings.json`, an unknown process modifies a launchd plist), that observation is valuable to every other tripwire user.

The feed becomes a public good: a near-real-time, reproducible, signed list of packages whose *runtime behavior* has triggered tripwire rules in the wild. This is structurally complementary to Aikido's and Socket's install-time feeds, not overlapping. Where they say "this package is bad based on static signals," we say "here's what a package did when it ran."

This document specifies how that feed works without compromising the privacy of the users who contribute to it.

## 2. Non-Goals

- **Not user telemetry.** The maintainers do not need or want to know who is running tripwire, what projects they have, or what they install. If the design ever requires that, the design is wrong.
- **Not a replacement for OSV or GitHub Advisory.** Those are authoritative, curated databases with their own governance. The community feed is a faster, complementary signal — and a *different shape* of signal (behavioral, not static). Where we have signal those feeds lack, we publish; where they publish first, we attach as a cross-reference.
- **Not a marketing channel.** The feed exists to inform defenders. It is not a vector for maintainer analytics, A/B tests, or growth instrumentation.
- **Not optional infrastructure.** Even if the community feed is never built, Phase 1 telemetry plumbing must be designed so the privacy posture is right from day one. Adding privacy after the fact is the wrong order.

## 3. Trust & Threat Model

### Threats to user privacy

| Threat | Mitigation |
|--------|------------|
| Feed operator learns which packages a user has installed | The canonical submission contains *only* the public package identifier + rule + a class-form path + an ancestry category. No user-derived fields. The operator could already learn package-installed-by-someone from npm download stats; we add no new attack surface. |
| Feed operator infers identity from submission patterns | Submissions are batched, jittered, and routed through HTTPS only. No persistent identifier, no client cert, no auth token. Per-IP rate-limited; IPs are not stored after rate-limit windows. |
| Network observer correlates user identity with submissions | TLS to the submission endpoint. Submissions can optionally route through Tor (Phase 2 of the feed itself). |
| Feed operator subpoenaed for user data | Operator has no user data to produce. This is the design intent: data minimization at source. |

### Threats to feed integrity

| Threat | Mitigation |
|--------|------------|
| Attacker submits fake IoCs to discredit good packages | Every submission is **re-verified**: the feed operator pulls the public tarball and re-runs a static fingerprint check on the package (verifying it matches the cited tarball hash) plus a behavioral re-verification in a sandbox (running the package's install + a minimal exercise loop and checking whether the cited rule actually fires). Submissions that don't reproduce are discarded. Reproduced submissions remain subject to curation. |
| Attacker floods feed with submissions to bury real findings | Per-IP rate limits + curation queue depth caps. Tiered trust: known submitters (security firms, established researchers) bypass staging. |
| Compromised submission endpoint poisons the feed | The published feed is signed (Sigstore + a feed-specific key). Tripwire clients verify signatures on every refresh. A compromised endpoint cannot produce a valid signed publication. |
| Feed maintainer becomes hostile / coerced | Open governance: all decisions logged publicly, mirrors operated by independent parties (Phase 3 of feed maturity), trust group rather than single BDFL. |
| Compromised tripwire client submits poison | Client submissions are not authoritative. Re-verification from the public tarball is the gate. A malicious client can submit, but cannot get a non-reproducible IoC published. |

### Threats to package maintainers

| Threat | Mitigation |
|--------|------------|
| False positive flags a legitimate package as malicious | Public dispute process. Maintainers can request review via a documented channel. Confirmed false positives are removed from the feed with a public correction. False-positive rate is tracked publicly per rule. |
| Slow correction after takedown | Removals propagate within the standard refresh interval (default 24h, configurable to 1h). Maintainers can request expedited review. |

## 4. Data Model — what gets shipped

**Core principle:** the unit of submission is a *package-behavior observation*, not a *user event*. A package is a public artifact. The observation describes the public artifact's runtime behavior, normalized so it carries no information about the user who observed it.

### Submission payload

```json
{
  "schema_version": "2",
  "package": {
    "ecosystem": "npm",
    "name": "@cap-js/db-service",
    "version": "2.10.1",
    "tarball_sha256": "a1b2c3..."
  },
  "rule_fires": [
    {
      "rule_id": "cred.aws-credentials-read",
      "rule_pack_version": "2026.05.16",
      "evidence": {
        "path_class": "~/.aws/credentials",
        "event_kind": "read",
        "ancestry_category": "package-manager-spawned"
      }
    }
  ],
  "scanner_version": "0.3.2",
  "submission_id": "ephemeral-uuid",
  "submitted_at_bucket": "2026-05-16T14:00:00Z"
}
```

### What is in the payload (and why it's safe)

- **`package.*`** — all public information about a published artifact. Available to anyone who queries the registry.
- **`tarball_sha256`** — hash of the public tarball. Reproducible by the feed operator independently.
- **`rule_fires[].evidence.path_class`** — the **class-form** path the package's process touched (e.g. `~/.aws/credentials`). This is not the user's absolute path; it's the canonical home-relative or pattern form from the rule's `applies_to.path` field. The same on every machine.
- **`rule_fires[].evidence.event_kind`** — the watcher event kind (`read`, `write`, etc.).
- **`rule_fires[].evidence.ancestry_category`** — the classifier output (`package-manager-spawned`, etc.). An enum, not identifying.
- **`submitted_at_bucket`** — rounded to the hour. Not precise enough to correlate with login times or build pipelines.

### What is NOT in the payload (and never will be)

The schema **rejects** submissions containing any of the following, even if a buggy client tries to include them:

- Absolute filesystem paths from the user's machine.
- Any path outside the canonical class form (no `/Users/...`, `/home/...`, no project-relative paths).
- Username, hostname, IP, MAC, machine fingerprint of any kind.
- Project name or working directory.
- Environment variable names or contents (including the agent identity markers — the *category* is shipped, never the marker value).
- The `ancestry_summary_hash` from the local event. The hash is derived from process paths on the user's machine and could be slightly identifying; it's local-only.
- Argv from the firing process.
- Persistent client identifier (no install ID, no opaque user token).

The sanitizer is a pure function in `packages/feeds/src/community/sanitize.ts`. Every output passes through it. Submissions failing sanitizer assertions are dropped locally with a log entry; nothing leaves the machine.

### Optional aggregated signals (Phase 2 of feed)

Once the package-centric model is proven, we may add **prevalence** signal — how widely a flagged package was installed before being caught. This requires special handling:

- Coarse buckets only (e.g., "< 100 installs", "100–1k", "1k–10k", "10k+").
- Differential privacy noise added at submission time.
- Off by default; separate opt-in toggle from base feed contribution.
- Documented separately when shipped.

Phase 1 ships **without** prevalence. The package-centric model alone is enough to build a useful feed.

## 5. Submission Flow

### On the client (tripwire)

1. Rule fires during runtime monitoring.
2. Event is written to local SQLite store (always).
3. **If** community feed contribution is opted in (off by default):
   a. The event is queued for community submission.
   b. Sanitizer runs over the queued submission. Anything failing assertions is dropped.
   c. Submissions are batched (default: every 6 hours, configurable).
   d. Batched submissions are jittered (random delay 0–30 min) to defeat correlation.
   e. HTTPS POST to the submission endpoint.
4. The user can inspect the local submission queue at any time via `tripwire community queue`.
5. The user can dump exactly what was submitted in the last batch via `tripwire community last-submission`.

### On the server (feed aggregator)

1. Submission received. Rate-limited by source IP (no client identifier).
2. Schema validation. Anything containing prohibited fields → 400 + logged for monitoring.
3. Submission written to a staging queue keyed by `(ecosystem, package, version, rule_id)`. Multiple submissions for the same key are deduplicated.
4. **Re-verification worker** picks up new staging entries:
   a. Fetches the package tarball from the public registry.
   b. Verifies `tarball_sha256` matches the registry's published hash.
   c. Loads the rule pack version cited in the submission.
   d. Runs the package's install + a minimal exercise loop in a sandbox and confirms the cited rule fires under the cited ancestry category.
   e. If the rule fires → submission is confirmed. If it doesn't → discarded (logged for rule-quality monitoring).
5. Confirmed entries enter the **curation queue**.
6. **Curators** (initially the maintainers; later a trust group):
   a. Review for severity assessment.
   b. Check for active maintainer dispute.
   c. Cross-reference OSV / GitHub Advisory / Aikido — if already published there, attach as `cross_references` rather than mark duplicate.
   d. Promote to the published feed.
7. **Publication pipeline:**
   a. Confirmed IoC entries are committed to a public Git repo (`github.com/jmaleonard/tripwire-community-feed`).
   b. Cosigned with the feed's Sigstore identity.
   c. Distributed via the Git repo + a CDN-fronted JSON mirror.
8. **Tripwire clients** pull the latest signed feed snapshot at the configured refresh interval and verify the signature before merging into the local IoC DB.

### Tiered trust

Known submitters (organizational accounts from established security firms, verified researchers) can be configured to bypass the staging queue — their submissions are re-verified and published directly. This is for speed in active campaigns. The verification step (step 4) is **never** skipped, regardless of submitter trust.

## 6. Feed format

Published as a Git repo with append-only JSON files:

```
tripwire-community-feed/
├── README.md
├── SIGNING.md
├── snapshots/
│   ├── 2026/
│   │   ├── 05/
│   │   │   ├── 16.json
│   │   │   ├── 16.json.sig
│   │   │   ├── 17.json
│   │   │   └── 17.json.sig
├── latest.json -> snapshots/2026/05/17.json
└── corrections/
    └── 2026/
        └── 05/
            └── 14-correction-001.json
```

Each daily snapshot is a list of confirmed IoC entries:

```json
{
  "snapshot_date": "2026-05-17",
  "rule_pack_version": "2026.05.16",
  "entries": [
    {
      "ecosystem": "npm",
      "package": "node-ipc",
      "version": "12.0.1",
      "tarball_sha256": "a1b2...",
      "rule_id": "cred.aws-credentials-read",
      "observed_event_kind": "read",
      "observed_ancestry_category": "package-manager-spawned",
      "confirmed_at": "2026-05-14T16:23:00Z",
      "first_observed_at_bucket": "2026-05-14T14:00:00Z",
      "submitter_class": "anonymous",
      "cross_references": ["GHSA-xxxx-xxxx-xxxx", "AIKIDO-ML-9421"]
    }
  ]
}
```

Corrections (false-positive removals) are separate files that supersede earlier publications. Tripwire clients apply corrections in publication order.

## 7. Consumer model

### Tripwire as consumer

The community feed is one of several feed sources in `packages/feeds/`. It implements the same `FeedSource` interface as OSV, GitHub Advisory, Aikido. Differences:

- Signature verification is mandatory (other feeds use TLS only; this one additionally verifies a Sigstore signature against the published feed key).
- Refresh interval defaults to 1 hour (vs 24h for OSV).
- The merger gives community feed entries a slightly lower confidence weight than OSV/GHSA until they're cross-referenced.
- Entries carry the observed event kind and ancestry category; the engine surfaces these in notifications: "this package was last observed reading a credential file from a package-manager-spawned context."

### Third-party consumers

The feed is public. Other tools (Aikido, Socket, Snyk, OSS Review Toolkit, custom CI checks) can consume it directly. Documented at `feed.tripwire.jmaleonard.dev/docs`. CORS-enabled JSON endpoints, deterministic schema.

## 8. Privacy guarantees (user-facing)

These are the commitments we make to users who opt in. They should appear in `tripwire setup` and on the website verbatim:

1. **We never collect data that identifies you.** No username, hostname, IP retention, install ID, or persistent token.
2. **We never collect data from your projects.** Only public package artifacts, never your code or environment.
3. **We never sell, share, or trade submissions.** The submissions become public, signed, attributed feed entries — that's the entire point. There is no second use.
4. **You can audit what we send.** `tripwire community last-submission` shows the exact JSON of the most recent batch, byte-for-byte. `tripwire community queue` shows what's pending.
5. **You can stop at any time.** `tripwire community opt-out` clears the queue and disables future submissions immediately. Past submissions, by design, contain no data that could identify you, so there is nothing to delete.
6. **The opt-in is granular.** Base feed contribution can be enabled without enabling prevalence signal (Phase 2). Enabling one does not imply the other.
7. **The default is off.** No submission ever happens without an explicit opt-in. The default install posture is local-only.

## 9. Opt-in UX

### First-run prompt

During `tripwire setup`, after the basic configuration is done, the user is shown:

```
tripwire community feed
──────────────────────────────────────────────────────────────────────
The community feed publishes packages whose *runtime behavior* fires
tripwire's high-confidence rules in the wild. Other tripwire users
get the signal within an hour; many supply-chain attacks are caught
here in behavioral form before static feeds catch up.

Contributing means tripwire submits a small payload when a rule fires
on a public package. The payload contains ONLY:
  - The public package name, version, and tarball hash
  - The rule that fired
  - The class-form path the package touched (e.g. ~/.aws/credentials)
  - The event kind and ancestry category (an enum)

It does NOT contain anything from your machine, your projects, your
environment, your process identity, or any user-derived identifier.
You can review the exact bytes sent at any time with
`tripwire community last-submission`.

Read the full design: https://jmaleonard.github.io/agent-tripwire/community-feed

Contribute to the community feed? [y/N]
```

Default is no. The user must actively choose yes.

### Ongoing visibility

A persistent banner in the dashboard shows community feed status:

- Currently contributing: yes / no.
- Submissions in last 30 days: N.
- Most recent submission: `[Show]` (opens `last-submission` view).
- `[Opt out]` button.

### Audit commands

```bash
tripwire community status          # On/off, counts, last submission time
tripwire community queue           # Pending submissions, not yet sent
tripwire community last-submission # Exact bytes of last batch (or "no submissions yet")
tripwire community opt-out         # Disable + clear queue
```

## 10. Phase 1 plumbing requirements

Even if the community feed infrastructure is built after Phase 1 ships, Phase 1 must include the **client-side plumbing** to the right design:

### Phase 1 must include

1. **The `community_feed.*` config block** in `~/.tripwire/config.yaml`, defaulting to off:
   ```yaml
   community_feed:
     enabled: false
     endpoint: "https://feed.tripwire.jmaleonard.dev/submit"
     batch_interval_hours: 6
     batch_jitter_minutes: 30
     include_prevalence: false   # Phase 2 of feed
   ```
2. **A submission queue** in the SQLite store (separate table from `events`). Even when disabled, the table exists so opt-in flips a single switch.
3. **The sanitizer module** (`packages/feeds/src/community/sanitize.ts`) as a pure, well-tested function. Inputs are local `Event` rows; outputs are `CommunitySubmission` objects or sanitizer errors. Sanitizer assertions cover the prohibited-fields list in §4.
4. **The submission payload schema** (`schemas/community-submission.schema.json`) — single source of truth, validated by both client (before send) and server (after receive).
5. **The audit commands** (`tripwire community status|queue|last-submission|opt-out`) — wired to the queue table, returning empty results when disabled.
6. **Tests** verifying that with `community_feed.enabled: false`, no network calls are ever made to the submission endpoint regardless of how many rules fire.

### Phase 1 does NOT need

- The server-side aggregator (`feed.tripwire.jmaleonard.dev`).
- The re-verification worker (including the sandboxed package-exercise step).
- The curation queue UI.
- The publication pipeline.
- Cosigned snapshots.

Those are the **feed operator's** infrastructure, built separately. The Phase 1 client-side work is what locks in the privacy posture.

## 11. Governance

### Phase 1 of governance (now)

- Jared Leonard operates the submission endpoint and curation queue.
- All curation decisions are logged publicly in the feed Git repo (`curation-log/`).
- Maintainer disputes are handled via GitHub issue on the feed repo, with documented SLA.
- The feed's signing key is held by Jared Leonard with a documented key-rotation policy.

### Phase 2 of governance (after the feed has signal)

- A trust group is established with 3–5 independent maintainers from across the ecosystem.
- Curation decisions require two-of-N approval for novel publications.
- Removal of false positives requires only one approval (favor speed for corrections).
- Signing key is rotated to a threshold scheme (e.g., 2-of-3 Cosign keys).

### Phase 3 of governance (if the feed becomes infrastructure)

- Foundation or independent non-profit takes operational control.
- Multiple geographically distributed mirrors operated by independent parties.
- Formal vulnerability disclosure process for the feed itself.

## 12. Operational considerations

### Cost

- Submission endpoint: tiny payload, low QPS even at scale. A single small VPS handles 100k+ active tripwire installs at Phase 1 submission cadence.
- Re-verification worker: fetches tarballs (cached) and runs sandboxed package exercise. The compute is more than a static scan because we run the package; scales linearly with confirmed-IoC volume, not user volume.
- Storage: append-only Git repo. Years of history in GB scale.

### Abuse handling

- Submission rate limits per source IP (default: 100/hour). Adjustable based on observed traffic.
- Anomalous submission patterns (e.g., 500 submissions for fictional packages from one /24) trigger curator review and IP block.
- IP blocks are time-limited and do not result in persistent identifiers.

### Incident response

- The feed has a published incident response playbook.
- Compromise of signing key → immediate key revocation, signed revocation announcement, re-publish all entries under new key.
- Compromise of submission endpoint → endpoint goes read-only, staging queue audited, suspect entries pulled.
- Discovery of a published false positive → correction file within 1 hour for high-severity entries, 24h for others.

## 13. Open questions

1. **Sigstore vs. minisign vs. SSH-cert-based signing?** Sigstore has better tooling and identity transparency; minisign is simpler. Open question for the build.
2. **Sandboxing the re-verification worker.** Running unknown packages in a re-verification sandbox is itself a security problem. Likely solution: ephemeral microVMs (Firecracker), network-isolated except for resolver-mocking, with hard time/CPU caps. This is its own subspec.
3. **Maintainer pre-publication notice?** Should a package maintainer be notified *before* their package appears in the public feed, with a short window to dispute? Improves fairness but slows response. Possibly default to "no" for `critical` severity, "yes with 1h window" for `high` and below.
4. **Cross-feed deduplication semantics.** When OSV/Aikido publishes after we do, do we mark our entry as duplicate (deferring) or keep both? Keep both with a `cross_references` field; their entries are canonical static signals, ours preserves the behavioral timeline.
5. **DNT for IoC?** Some package authors might not want their (legitimately retracted) package versions to appear in any IoC feed. Likely out of scope — IoCs are factual reports of rule fires on public artifacts — but worth thinking about.

## 14. Build order

If/when the feed is built, the order is:

1. Client plumbing (Phase 1 of tripwire) — must be done regardless.
2. Submission endpoint (HTTP + schema validation + rate limit + write to staging).
3. Re-verification worker (including sandboxed package exercise).
4. Curation UI (could be as simple as a small dashboard reading the staging queue).
5. Publication pipeline (signed Git commits + CDN).
6. Tripwire client integration: feed consumer + signature verification.
7. Public documentation and onboarding for third-party consumers.

Each of these is its own PR series with its own spec. This document is the contract they all build against.

## 15. References

- Sigstore: https://www.sigstore.dev/
- OSV submission process: https://google.github.io/osv.dev/data/
- GitHub Advisory contribution: https://github.com/github/advisory-database
- Aikido public malware list: https://malware-list.aikido.dev/
- "Privacy by Design" foundational principles (Cavoukian, 2009): https://www.ipc.on.ca/wp-content/uploads/Resources/7foundationalprinciples.pdf
- npm registry tarball API: https://docs.npmjs.com/cli/v10/configuring-npm/package-json
