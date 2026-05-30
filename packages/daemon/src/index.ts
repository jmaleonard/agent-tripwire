export { Daemon, type DaemonOptions, type IoCSyncConfig } from './daemon.js';
export {
  IoCSyncService,
  DEFAULT_FEED_MANIFEST_URL,
  type IoCSyncOptions,
  type SyncResult,
  type SyncMode,
} from './ioc-sync.js';
export { DEFAULT_RULES } from './default-rules.js';
export { defaultWatchPaths } from './default-paths.js';
export { handleFsEvent, type PipelineDeps } from './pipeline.js';
export { createPlatformReader } from './platform.js';
