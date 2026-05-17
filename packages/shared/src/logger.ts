import pino from 'pino';

export type Logger = pino.Logger;

export interface LoggerOptions {
  level?: pino.LevelWithSilent;
  name?: string;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  return pino({
    level: opts.level ?? 'info',
    ...(opts.name !== undefined ? { name: opts.name } : {}),
  });
}
