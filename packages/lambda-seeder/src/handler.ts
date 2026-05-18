import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AikidoFeed, runSeeder, type FeedSource, type SeederResult } from '@tripwire/feeds';

export interface HandlerEnv {
  SNAPSHOT_BUCKET: string;
  SNAPSHOT_KEY_PREFIX?: string;
}

export interface HandlerResult {
  ok: boolean;
  ioc_count: number;
  source_stats: SeederResult['sourceStats'];
  dated_key: string;
  latest_key: string;
  bytes: number;
}

export interface HandlerDeps {
  s3?: S3Client;
  sources?: ReadonlyArray<FeedSource>;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export async function runHandler(deps: HandlerDeps = {}): Promise<HandlerResult> {
  const env = deps.env ?? process.env;
  const bucket = env.SNAPSHOT_BUCKET;
  if (!bucket) throw new Error('SNAPSHOT_BUCKET env var is required');
  const prefix = env.SNAPSHOT_KEY_PREFIX ?? 'snapshots/';

  const s3 = deps.s3 ?? new S3Client({});
  const sources = deps.sources ?? [new AikidoFeed()];
  const now = (deps.now ?? (() => new Date()))();

  const result = await runSeeder(sources);

  const payload = {
    generated_at: result.generatedAt,
    source_stats: result.sourceStats,
    entries: result.entries,
  };
  const body = JSON.stringify(payload);
  const datedKey = `${prefix}${now.toISOString().slice(0, 10)}.json`;
  const latestKey = `${prefix}latest.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: datedKey,
      Body: body,
      ContentType: 'application/json',
    }),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: latestKey,
      Body: body,
      ContentType: 'application/json',
    }),
  );

  return {
    ok: result.sourceStats.some(s => s.ok),
    ioc_count: result.entries.length,
    source_stats: result.sourceStats,
    dated_key: datedKey,
    latest_key: latestKey,
    bytes: Buffer.byteLength(body, 'utf-8'),
  };
}

// Lambda entrypoint.
export const handler = async (): Promise<HandlerResult> => runHandler();
