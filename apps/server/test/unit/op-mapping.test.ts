import { describe, expect, it } from 'vitest';
import { mapPriority, matchesTrigger, toWorkPackage } from '../../src/adapters/openproject/mapping.js';
import { rawWorkPackage } from '../helpers/op-fixtures.js';

describe('toWorkPackage', () => {
  it('maps the HAL resource to the domain WorkPackage', () => {
    const wp = toWorkPackage(rawWorkPackage());
    expect(wp).toEqual({
      id: 4711,
      subject: '[AI] Login fails without cookie',
      description: { raw: 'Steps to reproduce...' },
      status: 'New',
      type: 'Bug',
      priority: 'High',
      project: { id: 15, name: 'ParkingApp' },
      assignee: { id: 4, name: 'Ana Dev' },
      lockVersion: 3,
      updatedAt: '2026-09-14T09:00:00Z',
    });
  });

  it('omits the assignee when the link is null and tolerates a null description', () => {
    const wp = toWorkPackage(rawWorkPackage({ description: { format: 'markdown', raw: null, html: '' } }, { assignee: { href: null } }));
    expect(wp.assignee).toBeUndefined();
    expect(wp.description.raw).toBe('');
  });

  it('rejects a resource without a project link', () => {
    expect(() => toWorkPackage(rawWorkPackage({}, { project: { href: null } }))).toThrow(/project/);
  });
});

describe('mapPriority', () => {
  it('maps English and Spanish OpenProject names, defaulting to normal', () => {
    expect(mapPriority('High')).toBe('high');
    expect(mapPriority('Inmediata')).toBe('immediate');
    expect(mapPriority('Baja')).toBe('low');
    expect(mapPriority('normal')).toBe('normal');
    expect(mapPriority(undefined)).toBe('normal');
    expect(mapPriority('Whatever')).toBe('normal');
  });
});

describe('matchesTrigger', () => {
  const both = { kind: 'status_or_prefix', statusName: 'Ready for AI', subjectPrefix: '[AI]' } as const;

  it('matches on status name', () => {
    const wp = toWorkPackage(rawWorkPackage({ subject: 'Plain subject' }, { status: { href: '/api/v3/statuses/12', title: 'Ready for AI' } }));
    expect(matchesTrigger(wp, both)).toBe(true);
    expect(matchesTrigger(wp, { kind: 'status', statusName: 'Ready for AI' })).toBe(true);
    expect(matchesTrigger(wp, { kind: 'prefix', subjectPrefix: '[AI]' })).toBe(false);
  });

  it('matches the subject prefix case-insensitively, ignoring leading whitespace', () => {
    const wp = toWorkPackage(rawWorkPackage({ subject: '  [ai] something' }));
    expect(matchesTrigger(wp, both)).toBe(true);
    expect(matchesTrigger(wp, { kind: 'prefix', subjectPrefix: '[AI]' })).toBe(true);
    expect(matchesTrigger(wp, { kind: 'status', statusName: 'Ready for AI' })).toBe(false);
  });

  it('does not match when neither applies', () => {
    const wp = toWorkPackage(rawWorkPackage({ subject: 'Fix AI model' }));
    expect(matchesTrigger(wp, both)).toBe(false);
  });
});
