const DEFAULT_BASE = process.env.TRIPWIRE_URL ?? 'http://127.0.0.1:7878';

export class ApiClient {
  constructor(private readonly base: string = DEFAULT_BASE) {}

  async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(this.url(path));
    return this.parse<T>(res);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse<T>(res);
  }

  async del<T = unknown>(path: string): Promise<T> {
    const res = await fetch(this.url(path), { method: 'DELETE' });
    return this.parse<T>(res);
  }

  async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(this.url('/api/summary'));
      return res.ok;
    } catch {
      return false;
    }
  }

  private url(path: string): string {
    return `${this.base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private async parse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as T;
  }
}
