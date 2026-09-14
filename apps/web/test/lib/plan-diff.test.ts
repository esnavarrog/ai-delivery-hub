import { describe, expect, it } from 'vitest';
import { changedSectionPaths, changedTopLevelSections } from '@/lib/plan-diff';
import { plan } from '../fixtures/ticket';

describe('changedSectionPaths', () => {
  it('returns an empty list for identical plans regardless of key order', () => {
    const a = plan();
    const b = { ...plan() };
    expect(changedSectionPaths(a, b)).toEqual([]);
  });

  it('reports scalar sections by key and array sections by index, in canonical order', () => {
    const a = plan();
    const b = plan({
      goal: 'Expose a refund endpoint with audit log',
      steps: [
        { order: 1, title: 'Add controller', detail: 'Create the controller', tests: ['refunds_controller_spec.rb'] },
        { order: 2, title: 'Add audit log', detail: 'Write an audit row', tests: ['audit_spec.rb'] },
      ],
      rollback: 'Revert and restore snapshot',
    });
    expect(changedSectionPaths(a, b)).toEqual(['goal', 'steps[1]', 'rollback']);
  });

  it('reports removed array entries', () => {
    const a = plan({ tests: ['one', 'two'] });
    const b = plan({ tests: ['one'] });
    expect(changedSectionPaths(a, b)).toEqual(['tests[1]']);
  });
});

describe('changedTopLevelSections', () => {
  it('collapses indexed paths to their section key', () => {
    expect([...changedTopLevelSections(['goal', 'steps[1]', 'steps[3]', 'rollback'])]).toEqual(['goal', 'steps', 'rollback']);
  });
});
