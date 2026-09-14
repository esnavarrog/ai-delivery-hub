import { formatDistanceToNowStrict } from 'date-fns';

/** `0s`, `45s`, `2m 5s`, `1h 2m`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** Whole-minute elapsed time for "AI is working" labels; seconds under one minute. */
export function formatElapsed(startedAt: string, now: Date): string {
  const ms = now.getTime() - new Date(startedAt).getTime();
  if (ms < 60_000) return formatDuration(ms);
  return `${Math.floor(ms / 60_000)}m`;
}

export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return 'n/a';
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${trim((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1_000) return `${trim((n / 1_000).toFixed(1))}k`;
  return String(n);
}

const trim = (s: string): string => s.replace(/\.?0+$/, '');

/** `plan_changes_requested` -> `plan changes requested`; optionally capitalised. */
export function humanize(id: string, capitalize = false): string {
  const text = id.replace(/_/g, ' ');
  return capitalize ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function relativeTime(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}
