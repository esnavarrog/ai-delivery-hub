import { describe, expect, it } from 'vitest';
import { extractUserContent, MIRROR_MARKER, renderMirrorNote, type MirrorFrontmatter } from '../../src/adapters/obsidian/mirror-note.js';

const fm: MirrorFrontmatter = {
  key: 'OP-4711',
  source: 'openproject',
  title: 'Login fails without cookie',
  state: 'plan_review',
  updatedAt: '2026-09-24T10:00:00.000Z',
  hubUrl: 'http://localhost:5173/tickets/t-1',
};

describe('renderMirrorNote', () => {
  it('renders hub-owned frontmatter, the marker, then the body verbatim', () => {
    const rendered = renderMirrorNote(fm, 'My own notes.\n- todo\n');
    expect(rendered).toBe(
      [
        '---',
        'key: OP-4711',
        'source: openproject',
        'title: Login fails without cookie',
        'state: plan_review',
        'updatedAt: 2026-09-24T10:00:00.000Z',
        'hubUrl: http://localhost:5173/tickets/t-1',
        '---',
        '',
        MIRROR_MARKER,
        'My own notes.\n- todo\n',
      ].join('\n'),
    );
  });

  it('includes riskTier and targetRepo only when present', () => {
    const withRisk = renderMirrorNote({ ...fm, riskTier: 'high', targetRepo: 'backend-parkingapp' }, '');
    expect(withRisk).toContain('riskTier: high');
    expect(withRisk).toContain('targetRepo: backend-parkingapp');
    expect(renderMirrorNote(fm, '')).not.toContain('riskTier');
  });

  it('renders a manual ticket key as the source key, not an OP id', () => {
    const rendered = renderMirrorNote({ ...fm, key: 'M-0001', source: 'manual' }, '');
    expect(rendered).toContain('key: M-0001');
    expect(rendered).toContain('source: manual');
  });
});

describe('extractUserContent', () => {
  it('returns everything after the marker, byte-for-byte, for an existing mirror note', () => {
    const existing = renderMirrorNote(fm, 'Line 1\nLine 2\n');
    expect(extractUserContent(existing)).toBe('Line 1\nLine 2\n');
  });

  it('preserves the marker-following content exactly even with unusual whitespace', () => {
    const existing = `---\nkey: OP-1\n---\n\n${MIRROR_MARKER}\n\n\n  indented\ntrailing   \n`;
    expect(extractUserContent(existing)).toBe('\n\n  indented\ntrailing   \n');
  });

  it('falls back to the body of a raw (non-mirror) note with its own frontmatter', () => {
    const raw = '---\ntitle: Fix the coffee machine\npriority: low\n---\n\nIt leaks.\n';
    expect(extractUserContent(raw)).toBe('It leaks.\n');
  });

  it('treats a plain file with no frontmatter as the whole body', () => {
    expect(extractUserContent('Just some text.\n')).toBe('Just some text.\n');
  });

  it('returns empty for a not-yet-existing file', () => {
    expect(extractUserContent(undefined)).toBe('');
  });
});
