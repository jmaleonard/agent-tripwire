import type { Ecosystem, IoCEntry, IoCRemoval, IoCSource } from '@tripwire/shared';
import type { DbHandle } from './db.js';

interface IoCRow {
  id: number;
  ecosystem: string;
  package: string;
  version_spec: string;
  sources: string;
  campaign: string | null;
  first_seen: string;
  last_seen: string;
}

export class IoCRepository {
  private readonly db: DbHandle;

  constructor(db: DbHandle) {
    this.db = db;
  }

  upsert(entries: ReadonlyArray<IoCEntry>): { count: number } {
    const insert = this.db.prepare(`
      INSERT INTO iocs (ecosystem, package, version_spec, sources, campaign, first_seen, last_seen)
      VALUES (@ecosystem, @package, @version_spec, @sources, @campaign, @first_seen, @last_seen)
      ON CONFLICT(ecosystem, package, version_spec) DO UPDATE SET
        sources = excluded.sources,
        campaign = COALESCE(excluded.campaign, iocs.campaign),
        last_seen = excluded.last_seen
    `);
    const tx = this.db.transaction((batch: ReadonlyArray<IoCEntry>) => {
      for (const e of batch) {
        insert.run({
          ecosystem: e.ecosystem,
          package: e.package,
          version_spec: e.version_spec,
          sources: JSON.stringify(e.sources),
          campaign: e.campaign ?? null,
          first_seen: e.first_seen,
          last_seen: e.last_seen,
        });
      }
    });
    tx(entries);
    return { count: entries.length };
  }

  /** Delete entries by identity tuple. Used when applying a feed delta's `removed`. */
  remove(removals: ReadonlyArray<IoCRemoval>): { count: number } {
    const del = this.db.prepare(
      'DELETE FROM iocs WHERE ecosystem = @ecosystem AND package = @package AND version_spec = @version_spec',
    );
    let count = 0;
    const tx = this.db.transaction((batch: ReadonlyArray<IoCRemoval>) => {
      for (const r of batch) {
        count += del.run(r).changes;
      }
    });
    tx(removals);
    return { count };
  }

  /**
   * Replace the entire IoC table with `entries` in one transaction. Used by the
   * sync service when downloading a full snapshot, so a stale local row that's
   * no longer in the feed doesn't linger.
   */
  replaceAll(entries: ReadonlyArray<IoCEntry>): { count: number } {
    const tx = this.db.transaction((batch: ReadonlyArray<IoCEntry>) => {
      this.db.exec('DELETE FROM iocs');
      this.upsert(batch);
    });
    tx(entries);
    return { count: entries.length };
  }

  lookup(ecosystem: Ecosystem, packageName: string): IoCEntry[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM iocs
        WHERE ecosystem = ? AND package = ?
        ORDER BY last_seen DESC
      `)
      .all(ecosystem, packageName) as IoCRow[];
    return rows.map(rowToEntry);
  }

  list(opts: { limit?: number; offset?: number } = {}): IoCEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM iocs ORDER BY last_seen DESC LIMIT ? OFFSET ?')
      .all(opts.limit ?? 1000, opts.offset ?? 0) as IoCRow[];
    return rows.map(rowToEntry);
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM iocs').get() as { c: number };
    return row.c;
  }
}

function rowToEntry(row: IoCRow): IoCEntry {
  const sources = JSON.parse(row.sources) as IoCSource[];
  return {
    id: row.id,
    ecosystem: row.ecosystem as Ecosystem,
    package: row.package,
    version_spec: row.version_spec,
    sources,
    ...(row.campaign !== null ? { campaign: row.campaign } : {}),
    first_seen: row.first_seen,
    last_seen: row.last_seen,
  };
}
