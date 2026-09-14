import { describe, expect, it } from 'vitest';
import { WorkPackage } from '../../src/ports/openproject.js';

const wp = {
  id: 1001,
  subject: 'Login fails without cookie',
  description: { raw: 'Steps to reproduce...' },
  status: 'New',
  type: 'Bug',
  project: { id: 7, name: 'Parking' },
  lockVersion: 3,
  updatedAt: '2026-09-14T09:00:00.000Z',
};

describe('WorkPackage', () => {
  it('parses a work package with and without assignee', () => {
    expect(WorkPackage.safeParse(wp).success).toBe(true);
    expect(WorkPackage.safeParse({ ...wp, assignee: { id: 4, name: 'Ana' } }).success).toBe(true);
  });

  it('requires description.raw, integer ids and an ISO updatedAt', () => {
    expect(WorkPackage.safeParse({ ...wp, description: 'plain' }).success).toBe(false);
    expect(WorkPackage.safeParse({ ...wp, id: '1001' }).success).toBe(false);
    expect(WorkPackage.safeParse({ ...wp, updatedAt: 'now' }).success).toBe(false);
  });
});

describe('WorkPackage priority', () => {
  it('accepts an optional priority name as reported by OpenProject', () => {
    expect(WorkPackage.safeParse({ ...wp, priority: 'High' }).success).toBe(true);
    expect(WorkPackage.safeParse({ ...wp, priority: 3 }).success).toBe(false);
  });
});
