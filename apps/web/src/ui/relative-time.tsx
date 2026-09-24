import { formatAbsolute, relativeTime } from '@/lib/format';

export function RelativeTime({ iso, prefix, className }: { iso: string; prefix?: string; className?: string }) {
  const absolute = formatAbsolute(iso);
  return (
    <time dateTime={iso} title={absolute} className={className}>
      {prefix ? `${prefix} ` : ''}
      {relativeTime(iso)}
    </time>
  );
}
