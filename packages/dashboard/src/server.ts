import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import type { DashboardDeps } from './deps.js';
import { allowlistRoutes } from './routes/allowlist.js';
import { eventsRoutes } from './routes/events.js';
import { iocsRoutes } from './routes/iocs.js';
import { snoozesRoutes } from './routes/snoozes.js';
import { summaryRoutes } from './routes/summary.js';
import { testEventRoutes } from './routes/test-event.js';
import { uiRoutes } from './routes/ui.js';

/**
 * Build the dashboard's Hono app. Pure function over DashboardDeps —
 * tests pass in-memory repos, daemon glue passes file-backed ones.
 */
export function createDashboard(deps: DashboardDeps): Hono {
  const app = new Hono();
  app.route('/', uiRoutes());
  app.route('/api/summary', summaryRoutes(deps));
  app.route('/api/events', eventsRoutes(deps));
  app.route('/api/snoozes', snoozesRoutes(deps));
  app.route('/api/allowlist', allowlistRoutes(deps));
  app.route('/api/iocs', iocsRoutes(deps));
  app.route('/api/test-event', testEventRoutes(deps));
  return app;
}

export interface StartOptions {
  port?: number;
  hostname?: string;
}

export interface RunningDashboard {
  app: Hono;
  server: ServerType;
  close: () => Promise<void>;
}

/**
 * Start an HTTP listener on the loopback interface. Used by daemon glue.
 * Tests should prefer `createDashboard(deps).request(url)` over spinning
 * up a real port.
 */
export function startDashboard(
  deps: DashboardDeps,
  opts: StartOptions = {},
): RunningDashboard {
  const app = createDashboard(deps);
  const server = serve({
    fetch: app.fetch,
    port: opts.port ?? 7878,
    hostname: opts.hostname ?? '127.0.0.1',
  });
  const close = (): Promise<void> =>
    new Promise(resolve => server.close(() => resolve()));
  return { app, server, close };
}
