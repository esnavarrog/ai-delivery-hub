import { describe, expect, it } from 'vitest';
import { parseDevUsers } from '@/app/current-user';

describe('parseDevUsers', () => {
  it('parses login:role pairs and tolerates missing or unknown roles', () => {
    expect(parseDevUsers('Macstban:admin, ana:dev ,bob,eve:wizard')).toEqual([{ login: 'Macstban', role: 'admin' }, { login: 'ana', role: 'dev' }, { login: 'bob' }, { login: 'eve' }]);
  });
  it('returns an empty list for undefined or blank input', () => {
    expect(parseDevUsers(undefined)).toEqual([]);
    expect(parseDevUsers(' , ')).toEqual([]);
  });
});
