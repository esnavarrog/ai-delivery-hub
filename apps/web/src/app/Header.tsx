import { Link } from '@tanstack/react-router';
import { Bot, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { DEV_USERS, setCurrentLogin, useCurrentLogin } from './current-user';
import { useMe } from './queries';

const NAV = [
  { to: '/inbox', label: 'Inbox' },
  { to: '/board', label: 'Board' },
  { to: '/runs', label: 'Runs' },
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
        <Link to="/inbox" className="inline-flex items-center gap-2 font-semibold" aria-label="AI Delivery Hub home">
          <Bot className="size-5 text-primary" aria-hidden="true" />
          AI Delivery Hub
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
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
          aria-label="Dev auth"
          onSubmit={(e) => {
            e.preventDefault();
            setCurrentLogin(draft);
          }}
        >
          <Badge variant="outline" className="gap-1 text-muted-foreground" title="Phase 1 development auth: the login is sent as the X-Hub-User header">
            <KeyRound className="size-3" aria-hidden="true" />
            dev auth
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
              <SelectTrigger className="h-8 w-44" aria-label="Current user">
                <SelectValue placeholder="Pick a user" />
              </SelectTrigger>
              <SelectContent>
                {DEV_USERS.map((u) => (
                  <SelectItem key={u.login} value={u.login}>
                    {u.login}
                    {u.role ? ` · ${u.role}` : ''}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Other login…</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <>
              <Input className="h-8 w-40" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="github login" aria-label="Login" />
              <Button type="submit" size="sm" variant="secondary" disabled={draft.trim().length === 0}>
                Use
              </Button>
              {DEV_USERS.length > 0 ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setCustom(false)}>
                  List
                </Button>
              ) : null}
            </>
          )}
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {login.length === 0 ? 'no user' : me.isError ? 'unknown user' : me.data ? `${me.data.login} · ${me.data.role}` : '…'}
          </span>
        </form>
      </div>
    </header>
  );
}
