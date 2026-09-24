import { Link } from '@tanstack/react-router';
import { Bot, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { es } from '@/i18n/es';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { DEV_USERS, setCurrentLogin, useCurrentLogin } from './current-user';
import { useMe } from './queries';

const NAV = [
  { to: '/solicitudes/nueva', label: es.nav.newRequest },
  { to: '/solicitudes', label: es.nav.myRequests },
  { to: '/inbox', label: es.nav.inbox },
  { to: '/board', label: es.nav.board },
  { to: '/runs', label: es.nav.runs },
] as const;

const CUSTOM = '__custom__';

export function Header() {
  const login = useCurrentLogin();
  const me = useMe();
  const known = DEV_USERS.some((u) => u.login === login);
  const [custom, setCustom] = useState(!known && login.length > 0);
  const [draft, setDraft] = useState(login);

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <Link to="/inbox" className="inline-flex items-center gap-2 font-semibold" aria-label={es.app.homeAriaLabel}>
          <Bot className="size-5 text-primary" aria-hidden="true" />
          {es.app.name}
        </Link>
        <nav aria-label={es.nav.main} className="flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: cn('bg-accent text-accent-foreground') }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form
          className="ml-auto flex flex-wrap items-center gap-2"
          aria-label={es.header.devAuthAriaLabel}
          onSubmit={(e) => {
            e.preventDefault();
            setCurrentLogin(draft);
          }}
        >
          <Badge variant="outline" className="gap-1 text-muted-foreground" title={es.header.devAuthBadgeTitle}>
            <KeyRound className="size-3" aria-hidden="true" />
            {es.header.devAuthBadge}
          </Badge>
          {DEV_USERS.length > 0 && !custom ? (
            <Select
              value={known ? login : CUSTOM}
              onValueChange={(v) => {
                if (v === CUSTOM) {
                  setCustom(true);
                  setDraft('');
                } else setCurrentLogin(v);
              }}
            >
              <SelectTrigger className="h-8 w-44" aria-label={es.header.currentUserAriaLabel}>
                <SelectValue placeholder={es.header.pickUserPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {DEV_USERS.map((u) => (
                  <SelectItem key={u.login} value={u.login}>
                    {u.login}
                    {u.role ? ` · ${u.role}` : ''}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>{es.header.otherLoginOption}</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <>
              <Input className="h-8 w-40" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={es.header.loginPlaceholder} aria-label={es.header.loginAriaLabel} />
              <Button type="submit" size="sm" variant="secondary" disabled={draft.trim().length === 0}>
                {es.header.useButton}
              </Button>
              {DEV_USERS.length > 0 ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setCustom(false)}>
                  {es.header.listButton}
                </Button>
              ) : null}
            </>
          )}
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {login.length === 0 ? es.header.noUser : me.isError ? es.header.unknownUser : me.data ? `${me.data.login} · ${me.data.role}` : '…'}
          </span>
        </form>
      </div>
    </header>
  );
}
