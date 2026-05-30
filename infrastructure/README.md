# infrastructure/

> **Deprecated.** The IoC seeder has moved off AWS to a free GitHub-hosted feed
> — see [`.github/workflows/seed-feed.yml`](../.github/workflows/seed-feed.yml)
> and [`spec/docs/feed.md`](../spec/docs/feed.md). This Lambda + S3 stack is kept
> for reference until the GitHub feed is verified live, then torn down (see
> "Tear down" below). No new work should target it.

CloudFormation IaC for the agent-tripwire IoC seeder Lambda.

## What this deploys

```
┌─────────────────────────┐         ┌──────────────────────────────────────────┐
│ EventBridge schedule    │ daily   │ Lambda: agent-tripwire-seeder            │
│ cron(0 6 * * ? *)  UTC  │────────▶│ Node 22, arm64, 512 MB, 5-min timeout    │
│ (daily 06:00 UTC)       │         │ runs @tripwire/feeds runSeeder()         │
└─────────────────────────┘         └──────────────────┬───────────────────────┘
                                                       │
                                                       ▼
                              ┌────────────────────────────────────────────┐
                              │ S3: agent-tripwire-snapshots-190236274723  │
                              │ snapshots/YYYY-MM-DD.json + latest.json    │
                              │ AES256, versioned, public-access blocked   │
                              └────────────────────────────────────────────┘
```

## Deploy

```bash
./infrastructure/deploy.sh
```

Idempotent. Each run:

1. Builds the Lambda bundle via esbuild (`packages/lambda-seeder/build.mjs`).
2. Uploads the zip to `s3://agent-trip-wire-git/lambda-code/handler-<sha>.zip`.
3. `aws cloudformation deploy` the stack (creates on first run, updates after).
4. `aws lambda update-function-code` to ensure the deployed code matches what we just uploaded (CloudFormation only swaps code when the S3 key parameter changes, so we update explicitly).

Override defaults via env vars:

```bash
STACK_NAME=... AWS_REGION=... SCHEDULE='cron(0 */6 * * ? *)' ./infrastructure/deploy.sh
```

## Invoke manually

```bash
aws lambda invoke --function-name agent-tripwire-seeder --region us-east-1 /tmp/out.json
cat /tmp/out.json
```

A successful run returns:

```json
{
  "ok": true,
  "ioc_count": 129622,
  "source_stats": [{"id": "aikido", "count": 129622, "ok": true}],
  "dated_key": "snapshots/2026-05-18.json",
  "latest_key": "snapshots/latest.json",
  "bytes": 27653336
}
```

## Inspect snapshots

```bash
aws s3 ls s3://agent-tripwire-snapshots-190236274723/snapshots/ --region us-east-1
aws s3 cp s3://agent-tripwire-snapshots-190236274723/snapshots/latest.json - --region us-east-1 | jq '.source_stats'
```

## Tear down

```bash
aws cloudformation delete-stack --stack-name agent-tripwire-seeder --region us-east-1
```

The snapshots bucket is created with `DeletionPolicy: Retain` so it survives stack deletion. To fully clean up:

```bash
aws s3 rm s3://agent-tripwire-snapshots-190236274723/ --recursive --region us-east-1
aws s3api delete-bucket --bucket agent-tripwire-snapshots-190236274723 --region us-east-1
```

## Permissions

The Lambda's IAM role allows:
- `s3:PutObject` / `s3:PutObjectAcl` on `${SnapshotsBucket}/*` only.
- CloudWatch Logs (via `AWSLambdaBasicExecutionRole` managed policy).

No other AWS permissions. The function does outbound HTTPS to `malware-list.aikido.dev` — no VPC, no NAT, just default internet egress.

## Cost

Negligible:
- Lambda: one invocation per day at ~30 s × 512 MB ≈ 0.005 GB-hours/month. Free tier covers it.
- S3: ~28 MB × 30 daily snapshots = ~840 MB stored. Pennies.
- EventBridge: $1/M rules. One rule, ~30 fires/month.
