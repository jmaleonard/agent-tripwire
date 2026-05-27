import { Hono } from 'hono';

const HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>agent-tripwire</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
    .subtitle { color: #666; margin: 0 0 1.25rem; }
    .counts { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.6rem; margin: 1rem 0 1.5rem; }
    .counts > div { text-align: center; padding: 0.7rem 0.4rem; border-radius: 6px; }
    .counts .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: #444; }
    .counts .n { font-size: 1.8rem; font-weight: 600; line-height: 1; }
    .critical { background: #fcdcdc; }
    .high { background: #ffe8c8; }
    .medium { background: #fff5b8; }
    .low { background: #e2eafc; }
    .info { background: #f0f0f0; }
    .snooze { padding: 0.6rem 0.8rem; background: #eef3ff; border-left: 3px solid #4a78d6; border-radius: 4px; margin: 0 0 1rem; }
    pre { background: #f5f5f5; padding: 0.8rem; border-radius: 4px; font-size: 0.85rem; overflow-x: auto; }
    h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: 0.04em; color: #444; margin-top: 1.6rem; }
    .down { color: #b00; }
  </style>
</head>
<body>
  <h1>agent-tripwire</h1>
  <p class="subtitle">A runtime detection daemon for developer workstations. The Preact UI ships in a follow-up; this page is the live counts surface + API directory.</p>
  <div id="status"></div>
  <div class="counts" id="counts" aria-live="polite"></div>
  <h2>API</h2>
  <pre>GET    /api/summary
GET    /api/events?since=&amp;severity=&amp;category=&amp;limit=&amp;offset=
GET    /api/events/:id
POST   /api/events/:id/action      body: { action: "allowlisted" | "dismissed" | "investigated" }

GET    /api/snoozes
POST   /api/snoozes                body: { kind, expires_at, [rule_id, ancestry_hash, reason] }
DELETE /api/snoozes/:id
DELETE /api/snoozes                (clear all)

GET    /api/allowlist
POST   /api/allowlist              body: { scope, rule_id, [ancestry_hash, process_path, ...] }
DELETE /api/allowlist/:id

GET    /api/iocs?ecosystem=npm&amp;package=node-ipc</pre>
  <script>
    async function refresh() {
      const counts = document.getElementById('counts');
      const status = document.getElementById('status');
      try {
        const res = await fetch('/api/summary', { cache: 'no-store' });
        if (!res.ok) throw new Error(res.statusText);
        const s = await res.json();
        counts.innerHTML = ['critical','high','medium','low','info']
          .map(k => '<div class="' + k + '"><div class="n">' + s.counts[k] + '</div><div class="label">' + k + '</div></div>')
          .join('');
        if (s.snoozes.active) {
          const exp = s.snoozes.expires_at ? new Date(s.snoozes.expires_at).toLocaleString() : '';
          status.innerHTML = '<div class="snooze">⌚ Snoozed (' + (s.snoozes.kind || 'active') + ') until ' + exp + '</div>';
        } else {
          status.innerHTML = '';
        }
      } catch (e) {
        counts.innerHTML = '';
        status.innerHTML = '<p class="down">Could not reach the daemon. Is tripwired running?</p>';
      }
    }
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>
`;

export function uiRoutes(): Hono {
  const r = new Hono();
  r.get('/', c => c.html(HTML));
  return r;
}
