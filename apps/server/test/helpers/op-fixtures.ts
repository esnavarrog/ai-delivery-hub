/** Raw OpenProject v3 JSON shapes used by unit tests (no network). */
export function rawWorkPackage(overrides: Record<string, unknown> = {}, links: Record<string, unknown> = {}) {
  return {
    _type: 'WorkPackage',
    id: 4711,
    subject: '[AI] Login fails without cookie',
    description: { format: 'markdown', raw: 'Steps to reproduce...', html: '<p>Steps</p>' },
    lockVersion: 3,
    createdAt: '2026-09-10T09:00:00Z',
    updatedAt: '2026-09-14T09:00:00Z',
    _links: {
      self: { href: '/api/v3/work_packages/4711', title: '[AI] Login fails without cookie' },
      status: { href: '/api/v3/statuses/1', title: 'New' },
      type: { href: '/api/v3/types/1', title: 'Bug' },
      priority: { href: '/api/v3/priorities/9', title: 'High' },
      project: { href: '/api/v3/projects/15', title: 'ParkingApp' },
      assignee: { href: '/api/v3/users/4', title: 'Ana Dev' },
      ...links,
    },
    ...overrides,
  };
}

export function rawCollection(
  elements: unknown[],
  { total, offset = 1, pageSize = 100 }: { total: number; offset?: number; pageSize?: number },
) {
  return {
    _type: 'Collection',
    total,
    count: elements.length,
    pageSize,
    offset,
    _embedded: { elements },
  };
}

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
}

/** Builds a fetch double that replays queued responses and records every call. */
export function fakeFetch(responses: Array<{ status?: number; json: unknown }>) {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch ${url.href}`);
    return new Response(JSON.stringify(next.json), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/hal+json' },
    });
  };
  return { fetchImpl, calls };
}
