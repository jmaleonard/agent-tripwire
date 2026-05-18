/** Pure parsers for Linux /proc file contents. Tested in isolation. */

/** Parse the PPid line from /proc/<pid>/status. Returns 0 when missing. */
export function parseStatusPpid(status: string): number {
  const m = status.match(/^PPid:\s*(\d+)/m);
  return m ? Number(m[1]) : 0;
}

/** Parse the Uid line. Returns the real UID (first column) or 0 if missing. */
export function parseStatusUid(status: string): number {
  const m = status.match(/^Uid:\s*(\d+)/m);
  return m ? Number(m[1]) : 0;
}

/** Parse /proc/<pid>/cmdline (null-separated argv). Empty input → []. */
export function parseCmdline(buf: Buffer): string[] {
  if (buf.length === 0) return [];
  // Trailing null is common; trim it before splitting.
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0) end--;
  if (end === 0) return [];
  return buf
    .subarray(0, end)
    .toString('utf-8')
    .split('\0');
}

/** Parse /proc/<pid>/environ (null-separated KEY=VALUE). */
export function parseEnviron(buf: Buffer): Record<string, string> {
  if (buf.length === 0) return {};
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0) end--;
  const out: Record<string, string> = {};
  if (end === 0) return out;
  const text = buf.subarray(0, end).toString('utf-8');
  for (const entry of text.split('\0')) {
    if (!entry) continue;
    const eq = entry.indexOf('=');
    if (eq <= 0) continue; // skip malformed
    const key = entry.slice(0, eq);
    out[key] = entry.slice(eq + 1);
  }
  return out;
}
