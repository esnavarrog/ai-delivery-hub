import { describe, expect, it } from 'vitest';
import {
  OpenProjectClient,
  OpenProjectConflictError,
  OpenProjectHttpError,
} from '../../src/adapters/openproject/client.js';
import { fakeFetch, rawCollection, rawWorkPackage } from '../helpers/op-fixtures.js';

const fixedClock = { now: () => new Date('2026-09-14T12:00:00.000Z'), nowIso: () => '2026-09-14T12:00:00.000Z' };

function client(responses: Array<{ status?: number; json: unknown }>) {
  const { fetchImpl, calls } = fakeFetch(responses);
  const op = new OpenProjectClient({ baseUrl: 'https://op.example.com/', apiKey: 'secret-key', fetch: fetchImpl, clock: fixedClock });
  return { op, calls };
}

describe('OpenProjectClient', () => {
  it('sends basic auth as apikey:<key> and parses the work package', async () => {
    const { op, calls } = client([{ json: rawWorkPackage() }]);
    const wp = await op.getWorkPackage(4711);
    expect(wp.id).toBe(4711);
    expect(calls[0]?.url.href).toBe('https://op.example.com/api/v3/work_packages/4711');
    expect(calls[0]?.headers.get('authorization')).toBe(`Basic ${Buffer.from('apikey:secret-key').toString('base64')}`);
    expect(calls[0]?.headers.get('accept')).toContain('json');
  });

  it('lists updated work packages with the updated_at <>d filter and paginates', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawWorkPackage({ id: i + 1 }));
    const page2 = [rawWorkPackage({ id: 101 }), rawWorkPackage({ id: 102 })];
    const { op, calls } = client([
      { json: rawCollection(page1, { total: 102, offset: 1 }) },
      { json: rawCollection(page2, { total: 102, offset: 2 }) },
    ]);
    const result = await op.listUpdatedSince(15, '2026-09-13T00:00:00.000Z');
    expect(result).toHaveLength(102);
    expect(result.at(-1)?.id).toBe(102);

    const first = calls[0]!.url;
    expect(first.pathname).toBe('/api/v3/projects/15/work_packages');
    expect(first.searchParams.get('pageSize')).toBe('100');
    expect(first.searchParams.get('offset')).toBe('1');
    const filters = JSON.parse(first.searchParams.get('filters')!);
    expect(filters).toEqual([{ updated_at: { operator: '<>d', values: ['2026-09-13T00:00:00.000Z', '2026-09-14T12:00:00.000Z'] } }]);
    expect(JSON.stringify(filters)).not.toContain('updatedAt');
    expect(calls[1]!.url.searchParams.get('offset')).toBe('2');
  });

  it('stops paginating when a page is short', async () => {
    const { op, calls } = client([{ json: rawCollection([rawWorkPackage()], { total: 1 }) }]);
    expect(await op.listUpdatedSince(15, '2026-09-13T00:00:00.000Z')).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('maps a 409 to OpenProjectConflictError and other errors to OpenProjectHttpError', async () => {
    const { op } = client([
      { status: 409, json: { _type: 'Error', errorIdentifier: 'urn:openproject-org:api:v3:errors:UpdateConflict', message: 'stale' } },
      { status: 500, json: { message: 'boom' } },
    ]);
    await expect(op.getWorkPackage(1)).rejects.toBeInstanceOf(OpenProjectConflictError);
    const err = await op.getWorkPackage(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenProjectHttpError);
    expect((err as OpenProjectHttpError).status).toBe(500);
  });

  it('never issues a non-GET request from any public method', async () => {
    const guardedFetch: typeof fetch = async (input, init) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') throw new Error(`unexpected ${method} request to ${String(input)}`);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/activities')) {
        return new Response(JSON.stringify(rawCollection([], { total: 0 })), { status: 200, headers: { 'content-type': 'application/hal+json' } });
      }
      if (url.includes('/work_packages/') && !url.includes('/projects/')) {
        return new Response(JSON.stringify(rawWorkPackage()), { status: 200, headers: { 'content-type': 'application/hal+json' } });
      }
      return new Response(JSON.stringify(rawCollection([rawWorkPackage()], { total: 1 })), { status: 200, headers: { 'content-type': 'application/hal+json' } });
    };
    const op = new OpenProjectClient({ baseUrl: 'https://op.example.com', apiKey: 'secret-key', fetch: guardedFetch, clock: fixedClock });

    await expect(op.getWorkPackage(4711)).resolves.toMatchObject({ id: 4711 });
    await expect(op.listUpdatedSince(15, '2026-09-13T00:00:00.000Z')).resolves.toHaveLength(1);
    await expect(op.getActivities(4711)).resolves.toEqual([]);
  });

  it('reads activities, separating comments from journal changes', async () => {
    const { op } = client([
      {
        json: {
          _type: 'Collection',
          _embedded: {
            elements: [
              { _type: 'Activity::Comment', id: 1, comment: { raw: 'Hola' }, details: [], createdAt: '2026-09-14T09:00:00Z', _links: { user: { href: '/api/v3/users/4', title: 'Ana' } } },
              { _type: 'Activity', id: 2, comment: { raw: '' }, details: [{ format: 'markdown', raw: 'Estado se cambió de New a Ready for AI', html: '' }], createdAt: '2026-09-14T09:05:00Z', _links: { user: { href: '/api/v3/users/4', title: 'Ana' } } },
            ],
          },
        },
      },
    ]);
    const activities = await op.getActivities(4711);
    expect(activities).toEqual([
      { id: 1, kind: 'comment', comment: 'Hola', details: [], userName: 'Ana', createdAt: '2026-09-14T09:00:00Z' },
      { id: 2, kind: 'change', comment: '', details: ['Estado se cambió de New a Ready for AI'], userName: 'Ana', createdAt: '2026-09-14T09:05:00Z' },
    ]);
  });
});
