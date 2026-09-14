import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function EmptyState({ icon, title, children, className }: { icon?: ReactNode; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center', className)} role="status">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <h3 className="text-base font-semibold">{title}</h3>
      {children ? <div className="max-w-md text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}
