import { Role } from '@ai-delivery-hub/domain';
import { useSyncExternalStore } from 'react';

export interface DevUser {
  login: string;
  role?: Role;
}

const STORAGE_KEY = 'ai-delivery-hub.current-user';

/** `"Macstban:admin,ana:dev"` -> users. Malformed entries are skipped. */
export function parseDevUsers(raw: string | undefined): DevUser[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [login, role] = entry.split(':').map((s) => s.trim());
      if (!login) return undefined;
      const parsed = Role.safeParse(role);
      return parsed.success ? { login, role: parsed.data } : { login };
    })
    .filter((u): u is DevUser => u !== undefined);
}

export const DEV_USERS: DevUser[] = parseDevUsers(import.meta.env['VITE_DEV_USERS'] as string | undefined);

const listeners = new Set<() => void>();
let current: string = readInitial();

function readInitial(): string {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // storage unavailable (private mode, tests); fall through
  }
  return DEV_USERS[0]?.login ?? '';
}

export function getCurrentLogin(): string {
  return current;
}

export function setCurrentLogin(login: string): void {
  current = login.trim();
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, current);
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCurrentLogin(): string {
  return useSyncExternalStore(subscribe, getCurrentLogin, getCurrentLogin);
}
