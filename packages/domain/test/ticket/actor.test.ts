import { describe, expect, it } from 'vitest';
import { Actor, ActorKind, Role } from '../../src/ticket/actor.js';

describe('Actor', () => {
  it('parses a valid actor', () => {
    expect(Actor.parse({ kind: 'dev', id: 'u-1' })).toEqual({ kind: 'dev', id: 'u-1' });
  });

  it('rejects unknown kinds and empty ids', () => {
    expect(Actor.safeParse({ kind: 'robot', id: 'x' }).success).toBe(false);
    expect(Actor.safeParse({ kind: 'dev', id: '' }).success).toBe(false);
  });

  it('exposes ActorKind and Role enums', () => {
    expect(ActorKind.options).toEqual(['ai', 'dev', 'qa', 'system']);
    expect(Role.options).toEqual(['requester', 'dev', 'lead', 'qa', 'admin']);
  });
});
