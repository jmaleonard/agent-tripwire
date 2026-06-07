import { basename } from 'node:path';
import type { Severity, TripwireEvent } from '@tripwire/shared';
import { Box, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { relativeTime } from '../format.js';
import type { CliRepos } from '../store.js';
import {
  allowlistEvent,
  dismissEvent,
  loadTuiState,
  snoozeEvent,
  type TuiState,
} from './data.js';

const REFRESH_MS = 2000;
const PAGE = 12;

export interface AppProps {
  repos: CliRepos;
}

export function App({ repos }: AppProps): ReactElement {
  const { exit } = useApp();
  const [state, setState] = useState<TuiState>(() => loadTuiState(repos));
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const reload = useCallback(() => setState(loadTuiState(repos)), [repos]);

  // Live refresh.
  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  const events = state.events;

  // Keep the selection in range as the event list grows/shrinks under us.
  useEffect(() => {
    setSelected(s => Math.max(0, Math.min(s, Math.max(0, events.length - 1))));
  }, [events.length]);

  const selectedIdx = events.length === 0 ? 0 : Math.min(selected, events.length - 1);
  const current = events[selectedIdx];

  const note = (msg: string): void => setFlash(msg);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      if (detail) setDetail(false);
      else exit();
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelected(s => Math.min(s + 1, Math.max(0, events.length - 1)));
      return;
    }
    if (key.upArrow || input === 'k') {
      setSelected(s => Math.max(0, s - 1));
      return;
    }
    if (key.return) {
      setDetail(d => !d);
      return;
    }
    if (input === 'r') {
      reload();
      note('refreshed');
      return;
    }
    if (!current) return;
    if (input === 'a') {
      allowlistEvent(repos, current);
      reload();
      note(`allowlisted ${current.rule_id}`);
    } else if (input === 's') {
      snoozeEvent(repos, current);
      reload();
      note(`snoozed ${current.rule_id} for 1h`);
    } else if (input === 'x') {
      dismissEvent(repos, current);
      reload();
      note('dismissed');
    }
  });

  // Clear the flash line after a moment.
  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <Box flexDirection="column">
      <Header state={state} />
      {events.length === 0 ? (
        <Box paddingX={1} paddingY={1}>
          <Text dimColor>No events yet. Try: tripwire test-event aws</Text>
        </Box>
      ) : detail && current ? (
        <Detail event={current} />
      ) : (
        <EventList events={events} selected={selectedIdx} />
      )}
      <Footer flash={flash} detail={detail} />
    </Box>
  );
}

function Header({ state }: { state: TuiState }): ReactElement {
  const s = state.summary;
  const c = s.counts;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box>
        <Text bold>tripwire </Text>
        <Text color={s.daemon.running ? 'green' : 'red'}>●</Text>
        <Text> {s.daemon.running ? 'daemon up' : 'daemon down'}</Text>
        <Text dimColor>{'  ·  '}feed {formatCount(s.ioc_count)} IoCs</Text>
      </Box>
      <Box>
        <Text dimColor>24h: </Text>
        <Text color="red">{c.critical} crit </Text>
        <Text color="yellow">{c.high} high </Text>
        <Text color="cyan">{c.medium} med </Text>
        <Text color="blue">{c.low} low </Text>
        {s.snoozes.active ? <Text color="magenta">{'  🔕 snoozed ('}{s.snoozes.kind})</Text> : null}
      </Box>
    </Box>
  );
}

function EventList({ events, selected }: { events: TripwireEvent[]; selected: number }): ReactElement {
  const start = Math.max(0, Math.min(selected - Math.floor(PAGE / 2), Math.max(0, events.length - PAGE)));
  const slice = events.slice(start, start + PAGE);
  return (
    <Box flexDirection="column" paddingX={1}>
      {slice.map((e, i) => {
        const isSel = start + i === selected;
        return (
          <Box key={e.event_id}>
            <Text color={isSel ? 'cyan' : 'gray'}>{isSel ? '❯ ' : '  '}</Text>
            <Text dimColor>{pad(relativeTime(e.timestamp), 9)} </Text>
            <Text color={sevColor(e.severity)}>{pad(sevLabel(e.severity), 5)} </Text>
            <Text bold={isSel}>{pad(e.rule_id, 26)} </Text>
            <Text dimColor>{who(e)}</Text>
            {flagged(e) ? <Text color="red"> ⚑</Text> : null}
          </Box>
        );
      })}
      {events.length > slice.length ? (
        <Text dimColor>
          {'  '}showing {start + 1}–{start + slice.length} of {events.length}
        </Text>
      ) : null}
    </Box>
  );
}

function Detail({ event }: { event: TripwireEvent }): ReactElement {
  const id = event.identity;
  const chain =
    id.ancestry_summary && id.ancestry_summary.length > 0
      ? id.ancestry_summary.join('  →  ')
      : id.process_path;
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box>
        <Text color={sevColor(event.severity)} bold>
          {sevLabel(event.severity)}{' '}
        </Text>
        <Text bold>{event.rule_name ?? event.rule_id}</Text>
      </Box>
      <Field label="when" value={relativeTime(event.timestamp)} />
      <Field label="path" value={`${event.event_kind ?? '?'}  ${event.path ?? '—'}`} />
      <Field label="who" value={`${who(event)}  [${id.category}]`} />
      <Field label="chain" value={chain} />
      {event.package ? <Field label="package" value={pkgLine(event.package)} /> : null}
      <Field label="action" value={event.user_action ?? 'pending'} />
      <Field label="hash" value={id.ancestry_summary_hash.slice(0, 16)} />
    </Box>
  );
}

function Field({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <Box>
      <Text dimColor>{pad(label, 8)}</Text>
      <Text>{value}</Text>
    </Box>
  );
}

function Footer({ flash, detail }: { flash: string | null; detail: boolean }): ReactElement {
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      {flash ? <Text color="green">{flash}</Text> : null}
      <Text dimColor>
        {detail ? '⏎/esc back · ' : '↑/↓ move · ⏎ detail · '}a allowlist · s snooze · x dismiss · r
        refresh · q quit
      </Text>
    </Box>
  );
}

const SEV_COLOR: Record<Severity, string> = {
  critical: 'red',
  high: 'yellow',
  medium: 'cyan',
  low: 'blue',
  info: 'gray',
};
const SEV_LABEL: Record<Severity, string> = {
  critical: 'CRIT',
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
  info: 'INFO',
};

function sevColor(s: Severity): string {
  return SEV_COLOR[s];
}
function sevLabel(s: Severity): string {
  return SEV_LABEL[s];
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s.padEnd(n);
}

function who(e: TripwireEvent): string {
  const id = e.identity;
  if (id.pid < 0 || id.process_path === '<unknown>') return id.category;
  return `${basename(id.process_path)} (${id.category})`;
}

function flagged(e: TripwireEvent): boolean {
  return Boolean(e.package?.ioc_attribution && e.package.ioc_attribution.length > 0);
}

function pkgLine(pkg: NonNullable<TripwireEvent['package']>): string {
  const camp = pkg.ioc_attribution?.find(a => a.campaign)?.campaign;
  const src = pkg.ioc_attribution?.map(a => a.source).join('/');
  let line = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
  if (src) line += `  flagged by ${src}${camp ? ` as ${camp}` : ''}`;
  return line;
}

function formatCount(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
