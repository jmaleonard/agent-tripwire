import { render } from 'ink';
import { withStore } from '../store.js';
import { App } from './App.js';

/**
 * Open the store and render the Ink TUI, keeping the DB open for the lifetime of
 * the session. Resolves when the user quits. The caller guarantees a TTY.
 */
export async function runTui(): Promise<number> {
  return withStore(async repos => {
    const instance = render(<App repos={repos} />);
    await instance.waitUntilExit();
    return 0;
  });
}
