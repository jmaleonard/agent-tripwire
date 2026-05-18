import type { IoCEntry } from '@tripwire/shared';
import { describe, expect, it, vi } from 'vitest';
import { runHandler } from '../src/handler.js';

function makeEntry(overrides: Partial<IoCEntry> = {}): IoCEntry {
  return {
    ecosystem: 'npm',
    package: 'node-ipc',
    version_spec: '12.0.1',
    sources: [{ name: 'aikido' }],
    first_seen: '2026-05-14T12:00:00.000Z',
    last_seen: '2026-05-14T12:00:00.000Z',
    ...overrides,
  };
}

function mockS3() {
  const puts: Array<{ Bucket?: string; Key?: string; Body?: unknown; ContentType?: string }> = [];
  const client = {
    send: vi.fn(async (cmd: { input: Record<string, unknown> }) => {
      puts.push(cmd.input as never);
      return {};
    }),
  };
  return { client: client as never, puts };
}

describe('runHandler', () => {
  it('writes dated and latest snapshots to S3', async () => {
    const { client, puts } = mockS3();
    const source = {
      id: 'aikido',
      async *refresh() {
        yield makeEntry();
      },
      async healthCheck() {
        return { ok: true, lastChecked: new Date().toISOString() };
      },
    };
    const result = await runHandler({
      s3: client,
      sources: [source],
      env: { SNAPSHOT_BUCKET: 'test-bucket' },
      now: () => new Date('2026-05-17T06:00:00.000Z'),
    });

    expect(puts).toHaveLength(2);
    expect(puts[0]?.Bucket).toBe('test-bucket');
    expect(puts[0]?.Key).toBe('snapshots/2026-05-17.json');
    expect(puts[1]?.Key).toBe('snapshots/latest.json');
    expect(result.ioc_count).toBe(1);
    expect(result.ok).toBe(true);
    expect(result.dated_key).toBe('snapshots/2026-05-17.json');
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('uses SNAPSHOT_KEY_PREFIX when provided', async () => {
    const { client, puts } = mockS3();
    const source = {
      id: 'aikido',
      async *refresh() {
        yield makeEntry();
      },
      async healthCheck() {
        return { ok: true, lastChecked: new Date().toISOString() };
      },
    };
    await runHandler({
      s3: client,
      sources: [source],
      env: { SNAPSHOT_BUCKET: 'b', SNAPSHOT_KEY_PREFIX: 'feed/v1/' },
      now: () => new Date('2026-05-17T06:00:00.000Z'),
    });
    expect(puts[0]?.Key).toBe('feed/v1/2026-05-17.json');
    expect(puts[1]?.Key).toBe('feed/v1/latest.json');
  });

  it('throws without SNAPSHOT_BUCKET', async () => {
    const { client } = mockS3();
    await expect(
      runHandler({
        s3: client,
        sources: [],
        env: {},
      }),
    ).rejects.toThrow(/SNAPSHOT_BUCKET/);
  });

  it('reports ok=false when every source failed', async () => {
    const { client } = mockS3();
    const failing = {
      id: 'failing',
      async *refresh(): AsyncIterable<IoCEntry> {
        throw new Error('boom');
        // eslint-disable-next-line no-unreachable
        yield* [];
      },
      async healthCheck() {
        return { ok: false, lastChecked: new Date().toISOString() };
      },
    };
    const result = await runHandler({
      s3: client,
      sources: [failing],
      env: { SNAPSHOT_BUCKET: 'b' },
      now: () => new Date('2026-05-17T06:00:00.000Z'),
    });
    expect(result.ok).toBe(false);
    expect(result.ioc_count).toBe(0);
    expect(result.source_stats[0]?.ok).toBe(false);
  });

  it('reports ok=true when at least one source succeeded', async () => {
    const { client } = mockS3();
    const failing = {
      id: 'failing',
      async *refresh(): AsyncIterable<IoCEntry> {
        throw new Error('boom');
        // eslint-disable-next-line no-unreachable
        yield* [];
      },
      async healthCheck() {
        return { ok: false, lastChecked: new Date().toISOString() };
      },
    };
    const ok = {
      id: 'ok',
      async *refresh() {
        yield makeEntry();
      },
      async healthCheck() {
        return { ok: true, lastChecked: new Date().toISOString() };
      },
    };
    const result = await runHandler({
      s3: client,
      sources: [failing, ok],
      env: { SNAPSHOT_BUCKET: 'b' },
      now: () => new Date('2026-05-17T06:00:00.000Z'),
    });
    expect(result.ok).toBe(true);
    expect(result.ioc_count).toBe(1);
  });
});
