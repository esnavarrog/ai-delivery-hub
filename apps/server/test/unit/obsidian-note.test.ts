import { describe, expect, it } from 'vitest';
import { InboxFrontmatter, parseNote } from '../../src/adapters/obsidian/note.js';

describe('parseNote', () => {
  it('splits frontmatter and body', () => {
    const raw = ['---', 'title: Fix the coffee machine', 'priority: high', 'tags: [facilities, urgent]', '---', '', 'It leaks from the side.', ''].join('\n');
    const { frontmatter, body } = parseNote(raw);
    expect(frontmatter).toEqual({ title: 'Fix the coffee machine', priority: 'high', tags: ['facilities', 'urgent'] });
    expect(body).toBe('It leaks from the side.\n');
  });

  it('treats a note with no frontmatter block as empty frontmatter and the whole file as body', () => {
    const { frontmatter, body } = parseNote('Just a plain note.\n');
    expect(frontmatter).toEqual({});
    expect(body).toBe('Just a plain note.\n');
  });

  it('throws a readable error on malformed YAML or a non-mapping frontmatter', () => {
    expect(() => parseNote('---\n[not, a, mapping]\n---\nbody')).toThrow(/mapping/);
    expect(() => parseNote('---\ntitle: "unterminated\n---\nbody')).toThrow(/YAML/);
  });
});

describe('InboxFrontmatter', () => {
  it('requires a non-empty title; everything else is optional', () => {
    expect(InboxFrontmatter.safeParse({ title: 'x' }).success).toBe(true);
    expect(InboxFrontmatter.safeParse({}).success).toBe(false);
    expect(InboxFrontmatter.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('accepts repo, priority and tags when present, and rejects an unknown priority', () => {
    const r = InboxFrontmatter.safeParse({ title: 'x', repo: 'backend-parkingapp', priority: 'high', tags: ['a', 'b'] });
    expect(r.success).toBe(true);
    expect(InboxFrontmatter.safeParse({ title: 'x', priority: 'urgent' }).success).toBe(false);
  });
});
