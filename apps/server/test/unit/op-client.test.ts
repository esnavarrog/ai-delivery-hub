import { describe, expect, it } from 'vitest';
import {
  OpenProjectClient,
  OpenProjectConflictError,
  OpenProjectHttpError,
} from '../../src/adapters/openproject/client.js';
import { fakeFetch, rawCollection, rawStatuses, rawWorkPackage } from '../helpers/op-fixtures.js';

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

  it('posts a comment as {comment:{raw}} and returns the activity id', async () => {
    const { op, calls } = client([{ status: 201, json: { _type: 'Activity::Comment', id: 999, comment: { raw: 'hi' } } }]);
    const res = await op.addComment(4711, 'hi');
    expect(res).toEqual({ commentId: '999' });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.pathname).toBe('/api/v3/work_packages/4711/activities');
    expect(calls[0]?.body).toEqual({ comment: { raw: 'hi' } });
    expect(calls[0]?.headers.get('content-type')).toBe('application/json');
  });

  it('patches the status with lockVersion and the status href', async () => {
    const { op, calls } = client([{ json: rawWorkPackage({ lockVersion: 4 }, { status: { href: '/api/v3/statuses/7', title: 'In specification' } }) }]);
    const wp = await op.setStatus(4711, 7, 3);
    expect(wp.status).toBe('In specification');
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url.pathname).toBe('/api/v3/work_packages/4711');
    expect(calls[0]?.body).toEqual({ lockVersion: 3, _links: { status: { href: '/api/v3/statuses/7' } } });
  });

  it('maps a 409 to OpenProjectConflictError and other errors to OpenProjectHttpError', async () => {
    const { op } = client([
      { status: 409, json: { _type: 'Error', errorIdentifier: 'urn:openproject-org:api:v3:errors:UpdateConflict', message: 'stale' } },
      { status: 500, json: { message: 'boom' } },
    ]);
    await expect(op.setStatus(4711, 7, 1)).rejects.toBeInstanceOf(OpenProjectConflictError);
    const err = await op.getWorkPackage(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenProjectHttpError);
    expect((err as OpenProjectHttpError).status).toBe(500);
  });

  it('resolves status ids by name once and caches them', async () => {
    const { op, calls } = client([{ json: rawStatuses }]);
    expect(await op.statusIdByName('In specification')).toBe(7);
    expect(await op.statusIdByName('Ready for AI')).toBe(12);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe('/api/v3/statuses');
    await expect(op.statusIdByName('Nope')).rejects.toThrow(/Nope/);
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
