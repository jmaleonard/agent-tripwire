import type { IoCEntry } from '@tripwire/shared';
import { describe, expect, it, vi } from 'vitest';
import { AikidoFeed, AIKIDO_NPM_URL, AIKIDO_PYPI_URL } from '../src/aikido.js';

const NPM_FIXTURE = [
  { package_name: 'node-ipc', version: '12.0.1', reason: 'MALWARE' },
  { package_name: '@evil/scoped', version: '*', reason: 'MALWARE' },
];
const PYPI_FIXTURE = [
  { package_name: 'stingxss', version: '0.1.6', reason: 'MALWARE' },
];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AikidoFeed', () => {
  it('yields npm and pypi entries with attribution', async () => {
    const fetchImpl = vi.fn(async (url: string | URL): Promise<Response> => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u === AIKIDO_NPM_URL) return jsonResponse(NPM_FIXTURE);
      if (u === AIKIDO_PYPI_URL) return jsonResponse(PYPI_FIXTURE);
      return new Response('not found', { status: 404 });
    });
    const feed = new AikidoFeed({ fetchImpl });

    const entries: IoCEntry[] = [];
    for await (const e of feed.refresh()) entries.push(e);

    expect(entries).toHaveLength(3);
    expect(entries.filter(e => e.ecosystem === 'npm')).toHaveLength(2);
    expect(entries.filter(e => e.ecosystem === 'pypi')).toHaveLength(1);

    const nodeIpc = entries.find(e => e.package === 'node-ipc')!;
    expect(nodeIpc.ecosystem).toBe('npm');
    expect(nodeIpc.version_spec).toBe('12.0.1');
    expect(nodeIpc.sources).toEqual([
      { name: 'aikido', metadata: { reason: 'MALWARE' } },
    ]);
    expect(nodeIpc.first_seen).toBe(nodeIpc.last_seen);
  });

  it('preserves scoped package names and wildcard versions', async () => {
    const fetchImpl = vi.fn(async (url: string | URL): Promise<Response> => {
      const u = typeof url === 'string' ? url : url.toString();
      return u === AIKIDO_NPM_URL ? jsonResponse(NPM_FIXTURE) : jsonResponse([]);
    });
    const feed = new AikidoFeed({ fetchImpl });
    const entries: IoCEntry[] = [];
    for await (const e of feed.refresh()) entries.push(e);

    const scoped = entries.find(e => e.package === '@evil/scoped')!;
    expect(scoped.version_spec).toBe('*');
  });

  it('throws when an upstream returns non-2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 503 }));
    const feed = new AikidoFeed({ fetchImpl });
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of feed.refresh()) {
        /* drain */
      }
    }).rejects.toThrow(/503/);
  });

  it('throws when the upstream returns a non-array payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ not: 'an array' }));
    const feed = new AikidoFeed({ fetchImpl });
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of feed.refresh()) {
        /* drain */
      }
    }).rejects.toThrow(/did not return an array/);
  });

  it('respects custom URLs', async () => {
    const customNpm = 'https://example.com/npm.json';
    const customPypi = 'https://example.com/pypi.json';
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      seen.push(typeof url === 'string' ? url : url.toString());
      return jsonResponse([]);
    });
    const feed = new AikidoFeed({ fetchImpl, npmUrl: customNpm, pypiUrl: customPypi });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of feed.refresh()) {
      /* drain */
    }
    expect(seen).toEqual([customNpm, customPypi]);
  });

  it('healthCheck returns ok on 2xx, not ok on error', async () => {
    const okFetch = vi.fn(async () => new Response('', { status: 200 }));
    expect((await new AikidoFeed({ fetchImpl: okFetch }).healthCheck()).ok).toBe(true);

    const errFetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await new AikidoFeed({ fetchImpl: errFetch }).healthCheck();
    expect(result.ok).toBe(false);
    expect(result.message).toBe('network down');
  });

  it('healthCheck reports a non-ok HTTP status', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 502 }));
    const result = await new AikidoFeed({ fetchImpl }).healthCheck();
    expect(result.ok).toBe(false);
    expect(result.message).toBe('HTTP 502');
  });
});
