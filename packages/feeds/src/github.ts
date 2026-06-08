/**
 * Shared plumbing for GitHub REST API feed sources (GHSA advisories, community
 * issue reports). Keeps auth headers and cursor pagination identical across
 * sources.
 */

/** Standard GitHub REST headers. A token lifts unauthenticated rate limits
 *  (60/hr) to 5000/hr; GitHub also requires a User-Agent. */
export function githubHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'tripwire-feed',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Extract the rel="next" URL from a GitHub `Link` header, or null when there
 *  is no further page. */
export function nextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1] ?? null;
  }
  return null;
}
