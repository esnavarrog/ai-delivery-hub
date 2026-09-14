import { relativeTime } from '@/lib/format';

export function RelativeTime({ iso, prefix, className }: { iso: string; prefix?: string; className?: string }) {
  const absolute = new Date(iso).toLocaleString();
  return (
    <time dateTime={iso} title={absolute} className={className}>
      {prefix ? `${prefix} ` : ''}
      {relativeTime(iso)}
    </time>
  );
}
